// api/webhook/pakasir.js  — UPDATE
// Setelah pembayaran sukses, cek apakah order adalah panel (PANEL-) atau isi saldo (NYZZ-)
// Kalau panel → trigger create-panel

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { amount, order_id, status, payment_method, completed_at } = req.body || {};

  if (!order_id || !amount || status !== 'completed') return res.status(200).json({ ok: false, reason: 'ignored' });

  // ===== ORDER PANEL (PANEL-username-...) =====
  if (order_id.startsWith('PANEL-')) {
    const parts    = order_id.split('-');
    const username = parts[1];

    // Ambil order dari GitHub
    const ghRes = await fetch(`https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/orders_panel/${username}/${order_id}.json`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    });
    if (!ghRes.ok) return res.status(200).json({ ok: false, reason: 'order panel not found' });

    const d     = await ghRes.json();
    const order = JSON.parse(Buffer.from(d.content, 'base64').toString());

    if (order.status !== 'pending') return res.status(200).json({ ok: true, reason: 'already processed' });
    if (Number(order.harga) !== Number(amount)) return res.status(200).json({ ok: false, reason: 'amount mismatch' });

    // Update status ke 'paid'
    const updated = { ...order, status: 'paid', paid_at: completed_at || new Date().toISOString(), payment_method: payment_method || 'qris' };
    await fetch(`https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/orders_panel/${username}/${order_id}.json`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({
        message: `panel: payment confirmed ${order_id}`,
        content: Buffer.from(JSON.stringify(updated, null, 2)).toString('base64'),
        branch:  process.env.GITHUB_BRANCH || 'main',
        sha:     d.sha
      })
    });

    // Trigger create-panel (internal call)
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      await fetch(`${baseUrl}/api/panel?action=create-panel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ order_id })
      });
    } catch (e) {
      console.error('create-panel trigger error:', e.message);
    }

    return res.status(200).json({ ok: true, type: 'panel' });
  }

  // ===== ORDER ISI SALDO (NYZZ-...) =====
  const { data: trx } = await supabase.from('transactions').select('*').eq('order_id', order_id).maybeSingle();
  if (!trx) return res.status(200).json({ ok: false, reason: 'transaction not found' });
  if (Number(trx.amount) !== Number(amount)) return res.status(200).json({ ok: false, reason: 'amount mismatch' });
  if (trx.status === 'completed') return res.status(200).json({ ok: true, reason: 'already completed' });

  await supabase.from('transactions').update({
    status: 'completed',
    payment_method: payment_method || 'qris',
    completed_at:   completed_at || new Date().toISOString()
  }).eq('order_id', order_id);

  await supabase.rpc('add_coins', { p_user_id: trx.user_id, p_amount: trx.amount });

  return res.status(200).json({ ok: true, type: 'topup' });
}

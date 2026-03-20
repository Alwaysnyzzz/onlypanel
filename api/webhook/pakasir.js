// api/webhook/pakasir.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { amount, order_id, status, payment_method, completed_at } = req.body || {};
  if (!order_id || status !== 'completed') return res.status(200).json({ ok: false });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ORDER PANEL
  if (order_id.startsWith('PANEL-')) {
    const { data: order } = await supabase.from('orders_panel').select('*').eq('order_id', order_id).single();
    if (!order) return res.status(200).json({ ok: false, reason: 'not found' });
    if (order.status !== 'pending') return res.status(200).json({ ok: true, reason: 'already processed' });
    if (Number(order.harga) !== Number(amount)) return res.status(200).json({ ok: false, reason: 'amount mismatch' });

    await supabase.from('orders_panel').update({ status: 'paid', paid_at: completed_at || new Date().toISOString(), payment_method: payment_method || 'qris' }).eq('order_id', order_id);

    try {
      const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      await fetch(`${base}/api/panel?action=create-panel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id }) });
    } catch (e) { console.error('create-panel error:', e.message); }

    return res.status(200).json({ ok: true, type: 'panel' });
  }

  return res.status(200).json({ ok: false, reason: 'unknown order type' });
}

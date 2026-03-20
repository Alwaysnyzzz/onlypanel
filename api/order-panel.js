// api/order-panel.js
// POST /api/order-panel
// Simpan data order panel ke GitHub + buat transaksi Pakasir
// Headers: Authorization: Bearer <token>
// Body: { nama_panel, panel_user, panel_password?, deskripsi?, spek }

import { createClient } from '@supabase/supabase-js';

const GH_TOKEN  = process.env.GITHUB_TOKEN;
const GH_OWNER  = process.env.GITHUB_OWNER;
const GH_REPO   = process.env.GITHUB_REPO;
const GH_BRANCH = process.env.GITHUB_BRANCH || 'main';

async function ghGet(path) {
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  });
  if (!res.ok) return null;
  const d = await res.json();
  return { data: JSON.parse(Buffer.from(d.content, 'base64').toString()), sha: d.sha };
}

async function ghPut(path, data, sha = null) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ message: `order: ${path}`, content, branch: GH_BRANCH, ...(sha ? { sha } : {}) })
  });
  if (!res.ok) throw new Error(await res.text());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Session tidak valid' });

  const { data: profile } = await supabase.from('profiles').select('username, coins').eq('id', user.id).single();
  if (!profile) return res.status(404).json({ error: 'Profil tidak ditemukan' });

  const { nama_panel, panel_user, panel_password, deskripsi, spek } = req.body || {};
  if (!nama_panel || !panel_user || !spek) return res.status(400).json({ error: 'Data tidak lengkap' });

  // Validasi spek
  const { ram_gb, cpu_pct, mem_mb, disk_mb, durasi_hari, tier, harga } = spek;
  if (!ram_gb || !durasi_hari || !harga) return res.status(400).json({ error: 'Spek tidak lengkap' });

  // Generate order_id: PANEL-username-timestamp-rand
  const rand    = Math.random().toString(36).substr(2, 5).toUpperCase();
  const orderId = `PANEL-${profile.username}-${Date.now()}-${rand}`;

  // Buat order di Pakasir
  let qrString, expiredAt;
  try {
    const pakRes  = await fetch('https://app.pakasir.com/api/transactioncreate/qris', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project:  process.env.PAKASIR_PROJECT,
        order_id: orderId,
        amount:   harga,
        api_key:  process.env.PAKASIR_API_KEY
      })
    });
    const pakData = await pakRes.json();
    console.log('[order-panel] Pakasir:', JSON.stringify(pakData));
    qrString  = pakData?.payment?.payment_number || pakData?.payment?.qr_string;
    expiredAt = pakData?.payment?.expired_at;
    if (!qrString) return res.status(502).json({ error: 'QR tidak tersedia dari payment gateway', detail: pakData });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal menghubungi payment gateway' });
  }

  // Simpan order JSON ke GitHub
  const orderData = {
    order_id:        orderId,
    owner:           profile.username,
    nama_panel,
    panel_user,
    panel_password:  panel_password || null,
    deskripsi:       deskripsi || '',
    ram_gb,
    cpu_pct:         cpu_pct || 100,
    mem_mb:          mem_mb || Math.round(parseFloat(ram_gb) * 1024),
    disk_mb:         disk_mb || Math.round(parseFloat(ram_gb) * 1024),
    durasi_hari:     parseInt(durasi_hari),
    tier:            tier || 'low',
    harga:           parseInt(harga),
    status:          'pending',
    server_id:       null,
    qr_string:       qrString,
    payment_expired: expiredAt,
    created_at:      new Date().toISOString()
  };

  const orderPath = `orders_panel/${profile.username}/${orderId}.json`;
  await ghPut(orderPath, orderData);

  // Update _list.json
  const listFile = await ghGet(`orders_panel/${profile.username}/_list.json`);
  const list     = listFile?.data || [];
  list.unshift({ order_id: orderId, nama_panel, tier, durasi_hari: parseInt(durasi_hari), harga: parseInt(harga), status: 'pending', created_at: orderData.created_at });
  await ghPut(`orders_panel/${profile.username}/_list.json`, list, listFile?.sha);

  return res.status(200).json({
    order_id:  orderId,
    qr_string: qrString,
    expired_at: expiredAt,
    amount:    harga
  });
}

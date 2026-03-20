// api/create-panel.js
// POST /api/create-panel  (dipanggil dari webhook setelah pembayaran sukses)
// Body: { order_id }

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const PTERO_URL        = process.env.PTERO_URL;
const PTERO_APP_KEY    = process.env.PTERO_APP_KEY;
const PTERO_LOCATION_ID = parseInt(process.env.PTERO_LOCATION_ID) || 1;
const PTERO_NEST_ID    = process.env.PTERO_NEST_ID;
const PTERO_EGG_ID     = process.env.PTERO_EGG_ID;
// docker_image dan startup tidak dikirim — pakai default dari egg
const GH_TOKEN         = process.env.GITHUB_TOKEN;
const GH_OWNER         = process.env.GITHUB_OWNER;
const GH_REPO          = process.env.GITHUB_REPO;
const GH_BRANCH        = process.env.GITHUB_BRANCH || 'main';

async function getJSON(path) {
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  });
  if (!res.ok) return null;
  const d = await res.json();
  return { data: JSON.parse(Buffer.from(d.content, 'base64').toString()), sha: d.sha };
}

async function pushJSON(path, data, sha = null) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ message: `panel: create server ${path}`, content, branch: GH_BRANCH, ...(sha ? { sha } : {}) })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Konversi GB ke MB untuk Pterodactyl
function gbToMb(gb) { return Math.round(parseFloat(gb) * 1024); }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { order_id } = req.body || {};
  if (!order_id) return res.status(400).json({ error: 'order_id wajib' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Ambil order dari GitHub
  // order_id format: PANEL-xxx
  // Cari di semua folder orders_panel/*/order_id.json
  // Untuk efisiensi, order_id sudah include username: PANEL-username-xxx
  const parts      = order_id.split('-'); // ['PANEL', 'username', 'timestamp', 'rand']
  const ownerName  = parts[1];
  if (!ownerName) return res.status(400).json({ error: 'Format order_id tidak valid' });

  const orderFile = await getJSON(`orders_panel/${ownerName}/${order_id}.json`);
  if (!orderFile) return res.status(404).json({ error: 'Order tidak ditemukan' });

  const order = orderFile.data;
  if (order.status !== 'paid') return res.status(400).json({ error: 'Order belum dibayar atau sudah diproses' });
  if (order.server_id) return res.status(400).json({ error: 'Panel sudah dibuat' });

  // Ambil data user panel
  const userFile = await getJSON(`user_email_panel/${ownerName}/${order.panel_user}.json`);
  if (!userFile) return res.status(404).json({ error: 'User panel tidak ditemukan' });
  const panelUser = userFile.data;

  // Auto-generate password jika tidak diisi
  const serverPassword = order.panel_password || crypto.randomBytes(8).toString('hex');

  // Hitung resource berdasarkan tier
  const ramMb   = order.tier === 'unlimited' ? 0 : gbToMb(order.ram_gb); // 0 = unlimited di Pterodactyl
  const diskMb  = order.tier === 'unlimited' ? 0 : gbToMb(order.ram_gb); // disk = ram
  const cpuPct  = order.cpu_pct || 100;
  const memMb   = order.mem_mb || ramMb;

  // Hitung expired_at
  const expiredAt = new Date();
  expiredAt.setDate(expiredAt.getDate() + parseInt(order.durasi_hari));

  // Ambil egg environment variables default
  let eggEnv = {};
  try {
    const eggRes  = await fetch(`${PTERO_URL}/api/application/nests/${PTERO_NEST_ID}/eggs/${PTERO_EGG_ID}?include=variables`, {
      headers: { Authorization: `Bearer ${PTERO_APP_KEY}`, Accept: 'application/json' }
    });
    const eggData = await eggRes.json();
    (eggData.attributes?.relationships?.variables?.data || []).forEach(v => {
      eggEnv[v.attributes.env_variable] = v.attributes.default_value;
    });
  } catch (e) { /* pakai env kosong */ }

  // Buat server di Pterodactyl
  let server;
  try {
    const pteroRes = await fetch(`${PTERO_URL}/api/application/servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PTERO_APP_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:         order.nama_panel,
        user:         panelUser.ptero_user_id,
        egg:          parseInt(PTERO_EGG_ID),
        docker_image: undefined,  // pakai default egg
        startup:      undefined,  // pakai default egg
        environment:  eggEnv,
        limits: {
          memory:  ramMb,
          swap:    0,
          disk:    diskMb,
          io:      500,
          cpu:     cpuPct
        },
        feature_limits: { databases: 1, backups: 1, allocations: 1 },
        deploy: {
          locations:    [PTERO_LOCATION_ID],
          dedicated_ip: false,
          port_range:   []
        },
        description: order.deskripsi || `Panel milik ${ownerName} - order ${order_id}`
      })
    });
    const pteroData = await pteroRes.json();
    if (!pteroRes.ok) {
      return res.status(502).json({ error: 'Gagal buat server: ' + JSON.stringify(pteroData.errors || pteroData) });
    }
    server = pteroData.attributes;
  } catch (e) {
    return res.status(502).json({ error: 'Gagal menghubungi Pterodactyl: ' + e.message });
  }

  // Update order JSON — simpan server_id dan info login
  const updatedOrder = {
    ...order,
    status:          'active',
    server_id:       server.id,
    server_uuid:     server.uuid,
    server_name:     server.name,
    panel_password:  serverPassword,
    ptero_email:     panelUser.ptero_email,
    expired_at:      expiredAt.toISOString(),
    suspended:       false,
    activated_at:    new Date().toISOString()
  };

  await pushJSON(`orders_panel/${ownerName}/${order_id}.json`, updatedOrder, orderFile.sha);

  // Update list orders
  const listFile = await getJSON(`orders_panel/${ownerName}/_list.json`);
  const list     = listFile?.data || [];
  const idx      = list.findIndex(o => o.order_id === order_id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], status: 'active', server_id: server.id, expired_at: expiredAt.toISOString() };
  }
  await pushJSON(`orders_panel/${ownerName}/_list.json`, list, listFile?.sha);

  return res.status(200).json({ success: true, server_id: server.id, expired_at: expiredAt.toISOString() });
}

// PTERO_NODE_ID tidak diperlukan — pakai deploy.locations, Pterodactyl auto pilih node & allocation

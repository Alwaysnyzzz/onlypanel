// api/panel.js — SEMUA PANEL API DALAM SATU FILE
// GET  /api/panel?action=get-panel-users
// GET  /api/panel?action=get-panel-order&order_id=xxx
// GET  /api/panel?action=get-server-status&server_uuid=xxx
// GET  /api/panel?action=get-riwayat-order
// POST /api/panel?action=order-panel
// POST /api/panel?action=create-panel
// POST /api/panel?action=create-panel-user
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const PTERO_URL         = process.env.PTERO_URL;
const PTERO_APP_KEY     = process.env.PTERO_APP_KEY;
const PTERO_CLIENT_KEY  = process.env.PTERO_CLIENT_KEY;
const PTERO_LOCATION_ID = parseInt(process.env.PTERO_LOCATION_ID) || 1;
const PTERO_NEST_ID     = process.env.PTERO_NEST_ID;
const PTERO_EGG_ID      = process.env.PTERO_EGG_ID;
const GH_TOKEN          = process.env.GITHUB_TOKEN;
const GH_OWNER          = process.env.GITHUB_OWNER;
const GH_REPO           = process.env.GITHUB_REPO;
const GH_BRANCH         = process.env.GITHUB_BRANCH || 'main';

async function ghGet(path) {
  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  });
  if (!r.ok) return null;
  const d = await r.json();
  return { data: JSON.parse(Buffer.from(d.content, 'base64').toString()), sha: d.sha };
}

async function ghPut(path, data, sha = null) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ message: `panel: ${path}`, content, branch: GH_BRANCH, ...(sha ? { sha } : {}) })
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function getProfile(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabase.from('profiles').select('username,coins').eq('id', user.id).single();
  return profile || null;
}

function gbToMb(gb) { return Math.round(parseFloat(gb) * 1024); }

export default async function handler(req, res) {
  const action = req.query.action;

  // GET: get-panel-users
  if (action === 'get-panel-users') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const profile = await getProfile(req);
    if (!profile) return res.status(401).json({ error: 'Unauthorized' });
    const f = await ghGet(`user_email_panel/${profile.username}/_list.json`);
    return res.status(200).json(f?.data || []);
  }

  // GET: get-panel-order
  if (action === 'get-panel-order') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { order_id } = req.query;
    if (!order_id) return res.status(400).json({ error: 'order_id wajib' });
    const username = order_id.split('-')[1];
    if (!username) return res.status(400).json({ error: 'Format order_id tidak valid' });
    const f = await ghGet(`orders_panel/${username}/${order_id}.json`);
    if (!f) return res.status(404).json({ error: 'Order tidak ditemukan' });
    const o = f.data;
    return res.status(200).json({
      order_id: o.order_id, nama_panel: o.nama_panel, ram_gb: o.ram_gb,
      cpu_pct: o.cpu_pct, mem_mb: o.mem_mb, disk_mb: o.disk_mb,
      durasi_hari: o.durasi_hari, tier: o.tier, harga: o.harga,
      status: o.status, server_id: o.server_id, server_uuid: o.server_uuid,
      ptero_email: o.ptero_email, panel_password: o.panel_password,
      expired_at: o.expired_at, activated_at: o.activated_at,
      created_at: o.created_at, deskripsi: o.deskripsi
    });
  }

  // GET: get-server-status
  if (action === 'get-server-status') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const profile = await getProfile(req);
    if (!profile) return res.status(401).json({ error: 'Unauthorized' });
    const { server_uuid } = req.query;
    if (!server_uuid) return res.status(400).json({ error: 'server_uuid wajib' });
    try {
      const r = await fetch(`${PTERO_URL}/api/client/servers/${server_uuid}/resources`, {
        headers: { Authorization: `Bearer ${PTERO_CLIENT_KEY}`, Accept: 'application/json' }
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return res.status(r.status).json({ error: e.errors?.[0]?.detail || r.status }); }
      const d = await r.json(); const a = d.attributes; const rs = a.resources;
      return res.status(200).json({
        status: a.current_state, is_online: a.current_state === 'running',
        ram_used: Math.round(rs.memory_bytes / 1024 / 1024),
        ram_limit: Math.round(rs.memory_limit_bytes / 1024 / 1024),
        cpu_used: Math.round(rs.cpu_absolute * 10) / 10,
        disk_used: Math.round(rs.disk_bytes / 1024 / 1024),
        uptime: rs.uptime_milliseconds
      });
    } catch (e) { return res.status(502).json({ error: e.message }); }
  }

  // GET: get-riwayat-order
  if (action === 'get-riwayat-order') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const profile = await getProfile(req);
    if (!profile) return res.status(401).json({ error: 'Unauthorized' });
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase.from('orders_panel')
      .select('order_id,nama_panel,ram_gb,cpu_pct,disk_mb,tier,harga,status,expired_at,created_at,server_uuid')
      .eq('owner_username', profile.username)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  // POST: order-panel
  if (action === 'order-panel') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const profile = await getProfile(req);
    if (!profile) return res.status(401).json({ error: 'Unauthorized' });
    const { nama_panel, panel_user, panel_password, deskripsi, spek } = req.body || {};
    if (!nama_panel || !panel_user || !spek) return res.status(400).json({ error: 'Data tidak lengkap' });
    const { ram_gb, cpu_pct, mem_mb, disk_mb, durasi_hari, tier, harga } = spek;
    if (!durasi_hari || !harga) return res.status(400).json({ error: 'Spek tidak lengkap' });
    const rand = Math.random().toString(36).substr(2, 5).toUpperCase();
    const orderId = `PANEL-${profile.username}-${Date.now()}-${rand}`;
    let qrString, expiredAt;
    try {
      const pakRes = await fetch('https://app.pakasir.com/api/transactioncreate/qris', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: process.env.PAKASIR_PROJECT, order_id: orderId, amount: harga, api_key: process.env.PAKASIR_API_KEY })
      });
      const pakData = await pakRes.json();
      qrString  = pakData?.payment?.payment_number || pakData?.payment?.qr_string;
      expiredAt = pakData?.payment?.expired_at;
      if (!qrString) return res.status(502).json({ error: 'QR tidak tersedia', detail: pakData });
    } catch (e) { return res.status(502).json({ error: 'Gagal menghubungi payment gateway' }); }

    // Simpan ke Supabase
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await supabase.from('orders_panel').insert({
      order_id: orderId, owner_username: profile.username, nama_panel, panel_user,
      panel_password: panel_password || null, deskripsi: deskripsi || '',
      ram_gb, cpu_pct: cpu_pct || 100,
      mem_mb: mem_mb || (ram_gb ? Math.round(parseFloat(ram_gb) * 1024) : 0),
      disk_mb: disk_mb || (ram_gb ? Math.round(parseFloat(ram_gb) * 1024) : 0),
      durasi_hari: parseInt(durasi_hari), tier: tier || 'low', harga: parseInt(harga),
      status: 'pending', qr_string: qrString, payment_expired: expiredAt
    });

    return res.status(200).json({ order_id: orderId, qr_string: qrString, expired_at: expiredAt, amount: harga });
  }

  // POST: create-panel (dipanggil dari webhook)
  if (action === 'create-panel') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { order_id } = req.body || {};
    if (!order_id) return res.status(400).json({ error: 'order_id wajib' });
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: order } = await supabase.from('orders_panel').select('*').eq('order_id', order_id).single();
    if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
    if (order.status !== 'paid') return res.status(400).json({ error: 'Order belum dibayar' });
    if (order.server_id) return res.status(400).json({ error: 'Panel sudah dibuat' });

    const userFile = await ghGet(`user_email_panel/${order.owner_username}/${order.panel_user}.json`);
    if (!userFile) return res.status(404).json({ error: 'User panel tidak ditemukan' });
    const panelUser = userFile.data;

    const serverPassword = order.panel_password || crypto.randomBytes(8).toString('hex');
    const ramMb  = order.tier === 'unlimited' ? 0 : gbToMb(order.ram_gb);
    const diskMb = order.tier === 'unlimited' ? 0 : gbToMb(order.ram_gb);

    const expiredAt = new Date();
    expiredAt.setDate(expiredAt.getDate() + parseInt(order.durasi_hari));

    let eggEnv = {};
    try {
      const eggR = await fetch(`${PTERO_URL}/api/application/nests/${PTERO_NEST_ID}/eggs/${PTERO_EGG_ID}?include=variables`, { headers: { Authorization: `Bearer ${PTERO_APP_KEY}`, Accept: 'application/json' } });
      const eggD = await eggR.json();
      (eggD.attributes?.relationships?.variables?.data || []).forEach(v => { eggEnv[v.attributes.env_variable] = v.attributes.default_value; });
    } catch (e) {}

    let server;
    try {
      const pteroRes = await fetch(`${PTERO_URL}/api/application/servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${PTERO_APP_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: order.nama_panel, user: panelUser.ptero_user_id, egg: parseInt(PTERO_EGG_ID),
          environment: eggEnv,
          limits: { memory: ramMb, swap: 0, disk: diskMb, io: 500, cpu: order.cpu_pct || 100 },
          feature_limits: { databases: 1, backups: 1, allocations: 1 },
          deploy: { locations: [PTERO_LOCATION_ID], dedicated_ip: false, port_range: [] },
          description: order.deskripsi || `Panel ${order.owner_username}`
        })
      });
      const pteroData = await pteroRes.json();
      if (!pteroRes.ok) return res.status(502).json({ error: 'Gagal buat server: ' + JSON.stringify(pteroData.errors || pteroData) });
      server = pteroData.attributes;
    } catch (e) { return res.status(502).json({ error: e.message }); }

    await supabase.from('orders_panel').update({
      status: 'active', server_id: server.id, server_uuid: server.uuid,
      panel_password: serverPassword, ptero_email: panelUser.ptero_email,
      expired_at: expiredAt.toISOString(), suspended: false, activated_at: new Date().toISOString()
    }).eq('order_id', order_id);

    return res.status(200).json({ success: true, server_id: server.id, expired_at: expiredAt.toISOString() });
  }

  // POST: create-panel-user
  if (action === 'create-panel-user') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const profile = await getProfile(req);
    if (!profile) return res.status(401).json({ error: 'Unauthorized' });
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: 'Username wajib diisi' });
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username 3-20 karakter, huruf kecil/angka/underscore' });
    const listPath = `user_email_panel/${profile.username}/_list.json`;
    const listFile = await ghGet(listPath);
    const userList = listFile?.data || [];
    if (userList.length >= 50) return res.status(400).json({ error: 'Maksimal 50 user panel per akun' });
    if (userList.find(u => u.username === username)) return res.status(400).json({ error: 'Username sudah ada' });
    const pteroEmail = `${username}@buyer.nyzz`;
    const pteroPass  = crypto.randomBytes(12).toString('hex');
    let pteroUser;
    try {
      const pteroRes = await fetch(`${PTERO_URL}/api/application/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${PTERO_APP_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pteroEmail, username: username, first_name: username, last_name: "buyer", password: pteroPass })
      });
      const pteroData = await pteroRes.json();
      if (!pteroRes.ok) return res.status(502).json({ error: 'Gagal buat user: ' + (pteroData.errors?.[0]?.detail || 'unknown') });
      pteroUser = pteroData.attributes;
    } catch (e) { return res.status(502).json({ error: e.message }); }
    const userData = { username, ptero_user_id: pteroUser.id, ptero_email: pteroEmail, ptero_username: pteroUser.username, owner_account: profile.username, created_at: new Date().toISOString() };
    await ghPut(`user_email_panel/${profile.username}/${username}.json`, userData);
    await ghPut(listPath, [...userList, { username, ptero_user_id: pteroUser.id, created_at: userData.created_at }], listFile?.sha || null);
    return res.status(200).json({ success: true, username, ptero_email: pteroEmail, ptero_user_id: pteroUser.id });
  }

  return res.status(400).json({ error: 'Action tidak valid' });
}

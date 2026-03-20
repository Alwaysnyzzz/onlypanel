// api/create-panel-user.js
// POST /api/create-panel-user
// Headers: Authorization: Bearer <token>
// Body: { username }
// Buat user di Pterodactyl + simpan ke GitHub JSON

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const PTERO_URL     = process.env.PTERO_URL;
const PTERO_APP_KEY = process.env.PTERO_APP_KEY;
const GH_TOKEN      = process.env.GITHUB_TOKEN;
const GH_OWNER      = process.env.GITHUB_OWNER;
const GH_REPO       = process.env.GITHUB_REPO;
const GH_BRANCH     = process.env.GITHUB_BRANCH || 'main';

// Helper: push file ke GitHub
async function pushJSON(path, data, sha = null) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      message: `panel-user: create ${path}`,
      content,
      branch: GH_BRANCH,
      ...(sha ? { sha } : {})
    })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Helper: ambil file dari GitHub
async function getJSON(path) {
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!res.ok) return null;
  const d = await res.json();
  return { data: JSON.parse(Buffer.from(d.content, 'base64').toString()), sha: d.sha };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verifikasi token via Supabase
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Session tidak valid' });

  // Ambil profile (username akun)
  const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single();
  if (!profile) return res.status(404).json({ error: 'Profil tidak ditemukan' });

  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Username wajib diisi' });
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username 3-20 karakter, huruf kecil/angka/underscore' });

  // Cek batas 50 user per akun
  const listPath = `user_email_panel/${profile.username}/_list.json`;
  const listFile = await getJSON(listPath);
  const userList = listFile?.data || [];
  if (userList.length >= 50) return res.status(400).json({ error: 'Maksimal 50 user panel per akun' });

  // Cek duplikat username
  if (userList.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Username sudah ada' });
  }

  // Generate email dummy untuk Pterodactyl
  const pteroEmail    = `${profile.username}_${username}@nyzz.panel`;
  const pteroPassword = crypto.randomBytes(12).toString('hex');

  // Buat user di Pterodactyl
  let pteroUser;
  try {
    const pteroRes = await fetch(`${PTERO_URL}/api/application/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PTERO_APP_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email:      pteroEmail,
        username:   `${profile.username}_${username}`,
        first_name: username,
        last_name:  profile.username,
        password:   pteroPassword
      })
    });
    const pteroData = await pteroRes.json();
    if (!pteroRes.ok) return res.status(502).json({ error: 'Gagal buat user di panel: ' + (pteroData.errors?.[0]?.detail || 'unknown') });
    pteroUser = pteroData.attributes;
  } catch (e) {
    return res.status(502).json({ error: 'Gagal menghubungi Pterodactyl: ' + e.message });
  }

  // Simpan data user ke GitHub
  const userData = {
    username,
    ptero_user_id: pteroUser.id,
    ptero_email:   pteroEmail,
    ptero_username: pteroUser.username,
    owner_account: profile.username,
    created_at:   new Date().toISOString()
  };

  const userFilePath = `user_email_panel/${profile.username}/${username}.json`;
  await pushJSON(userFilePath, userData);

  // Update _list.json
  const newList = [...userList, { username, ptero_user_id: pteroUser.id, created_at: userData.created_at }];
  await pushJSON(listPath, newList, listFile?.sha || null);

  return res.status(200).json({
    success: true,
    username,
    ptero_email: pteroEmail,
    ptero_user_id: pteroUser.id
  });
}

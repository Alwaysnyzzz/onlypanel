// api/get-panel-users.js
// GET /api/get-panel-users
// Headers: Authorization: Bearer <token>

import { createClient } from '@supabase/supabase-js';

async function getJSON(path) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!res.ok) return null;
  const d = await res.json();
  return JSON.parse(Buffer.from(d.content, 'base64').toString());
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Session tidak valid' });

  const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).single();
  if (!profile) return res.status(404).json({ error: 'Profil tidak ditemukan' });

  const list = await getJSON(`user_email_panel/${profile.username}/_list.json`);
  return res.status(200).json(list || []);
}

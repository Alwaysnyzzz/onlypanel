// api/auth.js
// POST /api/auth?action=login
// POST /api/auth?action=register
// POST /api/auth?action=change-password
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const action   = req.query.action;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // LOGIN
  if (action === 'login') {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
    const { data: profile } = await supabase.from('profiles').select('id,username').eq('username', username.toLowerCase().trim()).maybeSingle();
    if (!profile) return res.status(401).json({ error: 'Username atau password salah' });
    const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email: `${profile.username}@nyzz.internal`, password });
    if (signInErr) return res.status(401).json({ error: 'Username atau password salah' });
    return res.status(200).json({ session: signIn.session });
  }

  // REGISTER
  if (action === 'register') {
    const { username, password } = req.body || {};
    if (!username || !password)         return res.status(400).json({ error: 'Username dan password wajib diisi' });
    if (username.length < 3)            return res.status(400).json({ error: 'Username minimal 3 karakter' });
    if (!/^[a-z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Hanya huruf kecil, angka, underscore' });
    if (password.length < 6)            return res.status(400).json({ error: 'Password minimal 6 karakter' });
    const { data: existing } = await supabase.from('profiles').select('id').eq('username', username).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Username sudah dipakai' });
    const fakeEmail = `${username}@nyzz.internal`;
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({ email: fakeEmail, password, email_confirm: true });
    if (authErr) return res.status(400).json({ error: authErr.message });
    const { error: profileErr } = await supabase.from('profiles').insert({ id: authData.user.id, username, coins: 0 });
    if (profileErr) { await supabase.auth.admin.deleteUser(authData.user.id); return res.status(500).json({ error: 'Gagal membuat profil' }); }
    const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email: fakeEmail, password });
    if (signInErr) return res.status(500).json({ error: 'Akun dibuat tapi gagal login otomatis' });
    return res.status(200).json({ session: signIn.session });
  }

  // CHANGE PASSWORD
  if (action === 'change-password') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { old_password, new_password } = req.body || {};
    if (!old_password || !new_password) return res.status(400).json({ error: 'Semua field wajib diisi' });
    if (new_password.length < 6)        return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Session tidak valid' });
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: old_password });
    if (verifyErr) return res.status(401).json({ error: 'Password lama salah' });
    const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, { password: new_password });
    if (updateErr) return res.status(500).json({ error: 'Gagal mengubah password' });
    return res.status(200).json({ message: 'Password berhasil diubah' });
  }

  return res.status(400).json({ error: 'Action tidak valid' });
}

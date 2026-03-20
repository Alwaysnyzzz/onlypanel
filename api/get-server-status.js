// api/get-server-status.js
// GET /api/get-server-status?server_uuid=xxx
// Headers: Authorization: Bearer <token>
// Pakai PTERO_CLIENT_KEY (ptlc_) admin untuk ambil status realtime

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Session tidak valid' });

  const { server_uuid } = req.query;
  if (!server_uuid) return res.status(400).json({ error: 'server_uuid wajib' });

  try {
    const r = await fetch(`${process.env.PTERO_URL}/api/client/servers/${server_uuid}/resources`, {
      headers: {
        Authorization: `Bearer ${process.env.PTERO_CLIENT_KEY}`,
        Accept: 'application/json'
      }
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: 'Gagal ambil status: ' + (err.errors?.[0]?.detail || r.status) });
    }

    const data = await r.json();
    const attr = data.attributes;
    const res2 = attr.resources;

    return res.status(200).json({
      status:    attr.current_state,         // running / offline / starting / stopping
      is_online: attr.current_state === 'running',
      ram_used:  Math.round(res2.memory_bytes / 1024 / 1024),   // MB
      ram_limit: Math.round(res2.memory_limit_bytes / 1024 / 1024), // MB (0 = unlimited)
      cpu_used:  Math.round(res2.cpu_absolute * 10) / 10,        // %
      disk_used: Math.round(res2.disk_bytes / 1024 / 1024),      // MB
      uptime:    res2.uptime_milliseconds
    });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal menghubungi panel: ' + e.message });
  }
}

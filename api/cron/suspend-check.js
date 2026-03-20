// api/cron/suspend-check.js
// GET /api/cron/suspend-check
// Dipanggil otomatis oleh Vercel Cron Jobs setiap hari jam 00.00 UTC
// Tambahkan di vercel.json:
// "crons": [{ "path": "/api/cron/suspend-check", "schedule": "0 0 * * *" }]

const PTERO_URL     = process.env.PTERO_URL;
const PTERO_APP_KEY = process.env.PTERO_APP_KEY;
const GH_TOKEN      = process.env.GITHUB_TOKEN;
const GH_OWNER      = process.env.GITHUB_OWNER;
const GH_REPO       = process.env.GITHUB_REPO;
const GH_BRANCH     = process.env.GITHUB_BRANCH || 'main';

async function ghGet(path) {
  const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  });
  if (!res.ok) return null;
  const d = await res.json();
  return { data: JSON.parse(Buffer.from(d.content, 'base64').toString()), sha: d.sha };
}

async function ghPut(path, data, sha) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: JSON.stringify({ message: `cron: suspend-check ${new Date().toISOString()}`, content, branch: GH_BRANCH, sha })
  });
}

async function pteroSuspend(serverId) {
  const res = await fetch(`${PTERO_URL}/api/application/servers/${serverId}/suspend`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PTERO_APP_KEY}`, Accept: 'application/json' }
  });
  return res.ok;
}

export default async function handler(req, res) {
  // Verifikasi ini dipanggil dari Vercel Cron (bukan request random)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now     = new Date();
  let suspended = 0;
  let checked   = 0;
  let errors    = [];

  // Ambil semua folder di orders_panel/
  let folders;
  try {
    const res2 = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/orders_panel`, {
      headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    });
    if (!res2.ok) return res.status(200).json({ checked: 0, suspended: 0, message: 'orders_panel folder belum ada' });
    folders = await res2.json();
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }

  // Loop setiap user folder
  for (const folder of folders) {
    if (folder.type !== 'dir') continue;
    const username = folder.name;

    // Ambil _list.json
    const listFile = await ghGet(`orders_panel/${username}/_list.json`);
    if (!listFile) continue;

    let listChanged = false;
    const list = listFile.data;

    for (const item of list) {
      if (item.status !== 'active' || item.suspended) continue;
      checked++;

      const expiredAt = new Date(item.expired_at);
      if (expiredAt > now) continue; // belum expired

      // Expired! Suspend di Pterodactyl
      try {
        const ok = await pteroSuspend(item.server_id);
        if (ok) {
          item.suspended = true;
          item.status    = 'suspended';
          suspended++;
          listChanged    = true;

          // Update file order individual juga
          const orderFile = await ghGet(`orders_panel/${username}/${item.order_id}.json`);
          if (orderFile) {
            const updated = { ...orderFile.data, status: 'suspended', suspended: true, suspended_at: now.toISOString() };
            await ghPut(`orders_panel/${username}/${item.order_id}.json`, updated, orderFile.sha);
          }
        }
      } catch (e) {
        errors.push(`${item.order_id}: ${e.message}`);
      }
    }

    if (listChanged) {
      await ghPut(`orders_panel/${username}/_list.json`, list, listFile.sha);
    }
  }

  return res.status(200).json({ checked, suspended, errors, timestamp: now.toISOString() });
}

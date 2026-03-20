// api/get-panel-order.js
// GET /api/get-panel-order?order_id=PANEL-xxx
// Public — return data aman untuk struk

const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_OWNER = process.env.GITHUB_OWNER;
const GH_REPO  = process.env.GITHUB_REPO;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { order_id } = req.query;
  if (!order_id) return res.status(400).json({ error: 'order_id wajib' });

  const parts    = order_id.split('-');
  const username = parts[1];
  if (!username) return res.status(400).json({ error: 'Format order_id tidak valid' });

  const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/orders_panel/${username}/${order_id}.json`;
  const ghRes  = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  });

  if (!ghRes.ok) return res.status(404).json({ error: 'Order tidak ditemukan' });

  const d     = await ghRes.json();
  const order = JSON.parse(Buffer.from(d.content, 'base64').toString());

  // Return hanya field yang aman (jangan return qr_string ke publik)
  return res.status(200).json({
    order_id:     order.order_id,
    nama_panel:   order.nama_panel,
    ram_gb:       order.ram_gb,
    cpu_pct:      order.cpu_pct,
    mem_mb:       order.mem_mb,
    disk_mb:      order.disk_mb,
    durasi_hari:  order.durasi_hari,
    tier:         order.tier,
    harga:        order.harga,
    status:       order.status,
    server_id:    order.server_id,
    ptero_email:  order.ptero_email,
    panel_password: order.panel_password,
    expired_at:   order.expired_at,
    activated_at: order.activated_at,
    created_at:   order.created_at
  });
}

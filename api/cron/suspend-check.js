// api/cron/suspend-check.js
// Cron: 0 0 * * * (setiap hari jam 00.00 UTC)
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const now = new Date().toISOString();
  const { data: expired } = await supabase.from('orders_panel').select('order_id,server_id').eq('status', 'active').eq('suspended', false).lt('expired_at', now);
  let suspended = 0;
  for (const order of expired || []) {
    try {
      const r = await fetch(`${process.env.PTERO_URL}/api/application/servers/${order.server_id}/suspend`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.PTERO_APP_KEY}`, Accept: 'application/json' } });
      if (r.ok || r.status === 204) {
        await supabase.from('orders_panel').update({ status: 'suspended', suspended: true, suspended_at: now }).eq('order_id', order.order_id);
        suspended++;
      }
    } catch (e) {}
  }
  return res.status(200).json({ checked: expired?.length || 0, suspended, timestamp: now });
}

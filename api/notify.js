// Reçoit le webhook du Google Sheet et envoie la notif à tous les appareils
const webpush = require('web-push');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { secret, client, depot, commission, title, body } = req.body || {};
  if (!secret || secret !== (process.env.WEBHOOK_SECRET || '').trim()) {
    return res.status(401).json({ error: 'Secret invalide' });
  }

  webpush.setVapidDetails(
    'mailto:paul.soares.97s@gmail.com',
    (process.env.VAPID_PUBLIC_KEY || '').trim(),
    (process.env.VAPID_PRIVATE_KEY || '').trim()
  );

  // Format : commission en premier, en gras (titre), style Stripe
  // Emoji modifiable ici : 💸 🤑 🏦 ⚡ 🎯 🫀 💵 🚀
  const notifTitle = title || `💸 +${commission || '?'} $ ENCAISSÉS`;
  const notifBody =
    body || `${client || 'Nouveau client'} · Dépôt ${depot || '?'} $ · LET'S GOOOO 🚀`;

  const sbUrl = process.env.SUPABASE_URL.trim();
  const sbKey = process.env.SUPABASE_SERVICE_KEY.trim();
  const headers = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };

  const r = await fetch(
    `${sbUrl}/rest/v1/push_subscriptions?select=endpoint,subscription`,
    { headers }
  );
  if (!r.ok) return res.status(500).json({ error: await r.text() });
  const subs = await r.json();

  let sent = 0, removed = 0, failed = 0;
  await Promise.all(
    subs.map(async (row) => {
      try {
        await webpush.sendNotification(
          row.subscription,
          JSON.stringify({ title: notifTitle, body: notifBody })
        );
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          removed++;
          await fetch(
            `${sbUrl}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(row.endpoint)}`,
            { method: 'DELETE', headers }
          );
        } else {
          failed++;
        }
      }
    })
  );
  return res.status(200).json({ ok: true, sent, removed, failed });
};

// Enregistre un abonnement push dans Supabase
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { subscription, label } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Subscription manquante' });
  }
  const url = `${process.env.SUPABASE_URL.trim()}/rest/v1/push_subscriptions?on_conflict=endpoint`;
  const key = process.env.SUPABASE_SERVICE_KEY.trim();
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      subscription,
      user_label: label || null
    })
  });
  if (!r.ok) return res.status(500).json({ error: await r.text() });
  return res.status(200).json({ ok: true });
};

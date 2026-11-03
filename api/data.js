// GET /api/data?p=<token>      -> vue partenaire (sans marge agence)
// GET /api/data?admin=<clé>    -> vue agence (tous les partenaires)
const crypto = require('crypto');
const { partners, byToken } = require('./_lib/registry');
const { partnerMetrics, partnerView, agencyView } = require('./_lib/metrics');
const { hasServiceAccount } = require('./_lib/sources');

const memo = new Map(); // clé -> { at, body }
const TTL = 30 * 1000;

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function cached(key, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.body;
  const body = await fn();
  memo.set(key, { at: Date.now(), body });
  return body;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const q = req.query || {};
    const source = hasServiceAccount() ? 'privé' : 'public';

    if (q.admin !== undefined) {
      const key = process.env.BENA_ADMIN_KEY;
      if (!key || !safeEqual(q.admin, key)) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'Accès refusé' })); }
      const body = await cached('admin', async () => {
        const list = await partners();
        // Un fichier illisible ne bloque pas toute la vue agence.
        const settled = await Promise.allSettled(list.map(p => partnerMetrics(p)));
        const all = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
        const failed = list.filter((p, i) => settled[i].status === 'rejected').map(p => p.name);
        return { mode: 'agence', source, generatedAt: new Date().toISOString(), indisponibles: failed, ...agencyView(all) };
      });
      return res.end(JSON.stringify(body));
    }

    const p = await byToken(q.p);
    if (!p) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'Lien inconnu' })); }
    const body = await cached('p:' + p.slug, async () => {
      const m = await partnerMetrics(p);
      return { mode: 'partenaire', source, generatedAt: new Date().toISOString(), ...partnerView(m) };
    });
    return res.end(JSON.stringify(body));
  } catch (e) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: 'Lecture des données impossible', detail: String(e.message || e) }));
  }
};

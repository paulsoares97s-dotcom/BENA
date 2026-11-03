// Registre Partenaires : lu côté serveur, jamais exposé au navigateur.
const { readTabs, asText } = require('./sources');

const REGISTRY_ID = process.env.BENA_REGISTRY_ID || '1GYRZXUad1IGMf04IfeSteZl0cOEcTdwXOjb83Fi51bY';
const DEFAULT_SLUG = 'lenny'; // lien historique sans token

let cache = null; // { at, list }

async function partners() {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache.list;
  const tabs = await readTabs(REGISTRY_ID, ['Untitled']);
  const rows = tabs.Untitled || [];
  const list = rows
    .filter(r => r && asText(r[0]) && asText(r[0]).toLowerCase() !== 'slug')
    .map(r => ({
      slug: asText(r[0]).toLowerCase(), name: asText(r[1]), token: asText(r[2]),
      finance: asText(r[3]), live: asText(r[4]), statut: asText(r[5]).toLowerCase(), telegram: asText(r[6])
    }))
    .filter(p => p.finance && p.statut === 'actif');
  cache = { at: Date.now(), list };
  return list;
}

async function byToken(token) {
  const list = await partners();
  if (!token) return list.find(p => p.slug === DEFAULT_SLUG) || list[0] || null;
  return list.find(p => p.token === token) || null;
}

module.exports = { partners, byToken };

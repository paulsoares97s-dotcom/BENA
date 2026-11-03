// Icône de l'écran d'accueil propre à chaque lien (/api/icon?p=<token> ou ?admin=<clé>).
const { byToken } = require('./_lib/registry');
const KNOWN = ['lenny', 'romane', 'mohamed', 'incubeo'];
module.exports = async (req, res) => {
  const q = req.query || {};
  let slug = 'lenny';
  try {
    if (q.admin) slug = 'incubeo';
    else if (q.p) { const p = await byToken(q.p); if (p && KNOWN.includes(p.slug)) slug = p.slug; }
  } catch (e) { /* icône par défaut */ }
  const size = ['180', '192', '512'].includes(String(q.s)) ? q.s : '180';
  res.statusCode = 302;
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Location', '/icons/' + slug + '-' + size + '.png');
  res.end();
};

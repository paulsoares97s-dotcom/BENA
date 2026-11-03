// Manifest PWA par lien : l'icône de l'écran d'accueil rouvre le bon espace.
const { byToken } = require('./_lib/registry');

module.exports = async (req, res) => {
  const q = req.query || {};
  let name = 'BENA', start = '/', slug = 'lenny';
  try {
    if (q.admin) { name = 'Incubeo'; slug = 'incubeo'; start = '/?admin=' + encodeURIComponent(q.admin); }
    else if (q.p) { const p = await byToken(q.p); if (p) { name = p.name; slug = p.slug; start = '/?p=' + encodeURIComponent(q.p); } }
  } catch (e) { /* manifest par défaut */ }
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.end(JSON.stringify({
    name: name + ' — Dashboard', short_name: name.replace(/\s*\(.*\)\s*/, '').trim(), start_url: start, scope: '/', id: start,
    display: 'standalone', orientation: 'portrait', background_color: '#07060A', theme_color: '#07060A',
    icons: [
      { src: '/icons/' + slug + '-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/' + slug + '-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/' + slug + '-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
    ]
  }));
};

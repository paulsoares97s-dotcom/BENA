// Manifest PWA par lien : l'icône de l'écran d'accueil rouvre le bon espace.
const { byToken } = require('./_lib/registry');

module.exports = async (req, res) => {
  const q = req.query || {};
  let name = 'BENA', start = '/';
  try {
    if (q.admin) { name = 'Incubeo'; start = '/?admin=' + encodeURIComponent(q.admin); }
    else if (q.p) { const p = await byToken(q.p); if (p) { name = p.name; start = '/?p=' + encodeURIComponent(q.p); } }
  } catch (e) { /* manifest par défaut */ }
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.end(JSON.stringify({
    name: name + ' — Dashboard', short_name: name, start_url: start, scope: '/', id: start,
    display: 'standalone', orientation: 'portrait', background_color: '#000000', theme_color: '#000000',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }));
};

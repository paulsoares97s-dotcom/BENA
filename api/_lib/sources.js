// Lecture des Google Sheets, côté serveur uniquement.
// Deux modes :
//  1. Compte de service (GOOGLE_SA_EMAIL + GOOGLE_SA_KEY) : API Sheets officielle, fichiers privés.
//  2. Repli : endpoint public gviz (fichiers partagés « toute personne disposant du lien »).
// Dans les deux cas, chaque cellule est normalisée : nombre, texte, ou date « AAAA-MM-JJ ».

const crypto = require('crypto');

let cachedToken = null; // { token, exp }

function hasServiceAccount() {
  return Boolean(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_KEY);
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: process.env.GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const key = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const signature = crypto.createSign('RSA-SHA256').update(header + '.' + claim).sign(key, 'base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + header + '.' + claim + '.' + signature
  });
  if (!res.ok) throw new Error('Authentification Google refusée (' + res.status + ')');
  const json = await res.json();
  cachedToken = { token: json.access_token, exp: now + (json.expires_in || 3600) };
  return cachedToken.token;
}

// ---------- Normalisation ----------
const pad = n => String(n).padStart(2, '0');
function isoFromParts(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

function serialToIso(serial) {
  const ms = Math.round((serial - 25569) * 86400000); // 25569 = 01/01/1970 en série Sheets
  const d = new Date(ms);
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Texte « 1 500 $ », « $1 500 », « 30,0% », « €250 », « 7,1K » -> nombre ; sinon le texte d'origine.
function parseText(s) {
  const t = String(s).trim();
  if (t === '' || t === '–' || t === '-' || t === '—') return null;
  const fr = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fr) return { date: isoFromParts(+fr[3], +fr[2], +fr[1]) };
  const dur = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (dur) return (+dur[1]) / 24 + (+dur[2]) / 1440; // fraction de jour, comme Sheets
  const money = t.replace(/[\s  $€]/g, '');
  if (/^-?\d+(,\d+)?%$/.test(money)) return parseFloat(money.replace(',', '.')) / 100;
  if (/^-?\d+(,\d+)?K$/i.test(money)) return parseFloat(money.replace(',', '.')) * 1000;
  if (/^-?\d+([.,]\d+)?$/.test(money)) return parseFloat(money.replace(',', '.'));
  return t;
}

// ---------- Lecture ----------
// Retourne { [nomOnglet]: tableau 2D } ; les cellules dates sont des objets { date: 'AAAA-MM-JJ' }.
async function readTabs(sheetId, tabs) {
  if (hasServiceAccount()) return readTabsApi(sheetId, tabs);
  const out = {};
  await Promise.all(tabs.map(async tab => { out[tab] = await readTabGviz(sheetId, tab); }));
  return out;
}

async function readTabsApi(sheetId, tabs) {
  const token = await accessToken();
  const params = tabs.map(t => 'ranges=' + encodeURIComponent("'" + t + "'")).join('&');
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId + '/values:batchGet?' + params +
    '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER';
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('Lecture du fichier impossible (' + res.status + ')');
  const json = await res.json();
  const out = {};
  (json.valueRanges || []).forEach((vr, i) => {
    out[tabs[i]] = (vr.values || []).map(row => row.map(v => (typeof v === 'string' ? parseText(v) : v)));
  });
  return out;
}

async function readTabGviz(sheetId, tab) {
  const url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json&headers=0&sheet=' + encodeURIComponent(tab);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Lecture de l\'onglet ' + tab + ' impossible');
  const text = await res.text();
  const json = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
  if (json.status === 'error') return [];
  const rows = (json.table && json.table.rows) || [];
  return rows.map(r => (r.c || []).map(cell => {
    if (!cell || cell.v === null || cell.v === undefined) return cell && cell.f ? parseText(cell.f) : null;
    const v = cell.v;
    if (typeof v === 'string') {
      const m = v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
      if (m) {
        if (+m[1] <= 1900) return (+(m[4] || 0)) / 24 + (+(m[5] || 0)) / 1440; // durée (hh:mm)
        return { date: isoFromParts(+m[1], +m[2] + 1, +m[3]) };
      }
      return parseText(v);
    }
    return v;
  }));
}

// Une cellule qui doit être une date : objet date, série Sheets ou texte jj/mm/aaaa.
function asDate(v) {
  if (v && typeof v === 'object' && v.date) return v.date;
  if (typeof v === 'number' && v > 30000 && v < 80000) return serialToIso(v);
  if (typeof v === 'string') { const p = parseText(v); if (p && p.date) return p.date; }
  return null;
}

function asNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const p = parseText(v); return typeof p === 'number' ? p : 0; }
  return 0;
}

function asText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v.date) return v.date;
  return String(v).trim();
}

module.exports = { readTabs, asDate, asNumber, asText, hasServiceAccount };

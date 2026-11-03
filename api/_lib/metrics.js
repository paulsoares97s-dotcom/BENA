// Tous les calculs du dashboard, faits une seule fois côté serveur.
// Règles validées avec Paul :
//  - CA = commissions « Débloquée » uniquement ; « En attente » affiché à part.
//  - Mois calendaire pour le CA et la rémunération ; minimum garanti appliqué par mois.
//  - Encaissement par quinzaine : 1–15 payé le 28 du mois, 16–fin payé le 13 du mois suivant.
//  - Objectif mensuel = 2 × objectif de quinzaine (Paramètres B4).
//  - Frais lus par libellé dans la section « FRAIS RÉCURRENTS (€ / mois) ».

const { readTabs, asDate, asNumber, asText } = require('./sources');

const BROKERS = ['Axi', 'PUPrime', 'RaiseFX'];
const TZ = 'Europe/Paris';

// ---------- Dates (chaînes AAAA-MM-JJ, sans fuseau) ----------
function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate()); };
const parts = s => s.split('-').map(Number);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function addDays(s, n) { const [y, m, d] = parts(s); return iso(y, m, d + n); }
function daysBetween(a, b) { const [y1, m1, d1] = parts(a), [y2, m2, d2] = parts(b); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000); }
const inRange = (d, a, b) => d >= a && d <= b;

function monthOf(s) { const [y, m] = parts(s); return { key: y + '-' + pad(m), start: iso(y, m, 1), end: iso(y, m, lastDay(y, m)), y, m }; }
function quinzaineOf(s) {
  const [y, m, d] = parts(s);
  if (d <= 15) return { key: y + '-' + pad(m) + '-P1', start: iso(y, m, 1), end: iso(y, m, 15), payout: iso(y, m, 28), half: 1 };
  return { key: y + '-' + pad(m) + '-P2', start: iso(y, m, 16), end: iso(y, m, lastDay(y, m)), payout: iso(y, m + 1, 13), half: 2 };
}
function prevMonth(s) { const [y, m] = parts(s); return monthOf(iso(y, m - 1, 1)); }

// ---------- Normalisation des libellés ----------
const norm = s => asText(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
function statusOf(v) {
  const s = norm(v);
  if (!s) return '';
  if (s.startsWith('debloq')) return 'debloquee';
  if (s.includes('attente')) return 'attente';
  if (s.startsWith('annul')) return 'annulee';
  return s;
}

// ---------- Paramètres ----------
function readParams(rows) {
  const byLabel = sub => { const r = rows.find(r => r && norm(r[0]).includes(sub)); return r ? r[1] : null; };
  const params = {
    rate: asNumber(byLabel('taux eur')) || 1.08,
    objectifQuinzaine: asNumber(byLabel('objectif ca')) || asNumber(byLabel('objectif periode')) || 0,
    pctPartner: asNumber(byLabel('sur benefice')) || 0.3,
    minMensuel: asNumber(byLabel('minimum garanti')) || 0,
    fixes: [],
    variables: []
  };
  if (params.pctPartner > 1) params.pctPartner /= 100;
  // Section frais : de « FRAIS RÉCURRENTS » jusqu'au prochain titre « ▎ ».
  const start = rows.findIndex(r => r && norm(r[0]).includes('frais recurrents'));
  if (start >= 0) {
    for (let i = start + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !asText(r[0])) continue;
      if (asText(r[0]).startsWith('▎')) break;
      const label = asText(r[0]).replace(/\s*\((€|%)\)\s*$/, '');
      const val = asNumber(r[1]);
      if (norm(r[0]).includes('%')) params.variables.push({ label, pct: val > 1 ? val / 100 : val });
      else params.fixes.push({ label, eur: val, usd: Math.round(val * params.rate * 100) / 100 });
    }
  }
  return params;
}

// ---------- Dépôts ----------
function readDeposits(tabs) {
  const list = [];
  for (const broker of BROKERS) {
    const rows = tabs[broker] || [];
    rows.forEach((r, i) => {
      if (!r) return;
      const date = asDate(r[0]);
      const name = asText(r[1]);
      if (!date || !name) return;
      list.push({
        date, broker, row: i + 1,
        name, tg: asText(r[2]), clientId: asText(r[3]), setter: asText(r[4]),
        depot: asNumber(r[5]), mouvement: asNumber(r[6]), cumul: asNumber(r[7]),
        commission: asNumber(r[8]),
        statut: statusOf(r[9]), statutLabel: asText(r[9]),
        statutSetter: statusOf(r[10]), statutSetterLabel: asText(r[10]),
        paiement: asText(r[11])
      });
    });
  }
  list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return list;
}

// ---------- Funnel ----------
function readTelegram(rows) {
  const out = {};
  (rows || []).forEach(r => {
    const date = r && asDate(r[0]);
    if (!date) return;
    const membres = asNumber(r[2]), ajouts = asNumber(r[3]), departs = asNumber(r[4]), vues = asNumber(r[10]);
    if (!membres && !ajouts && !departs && !vues) return;
    out[date] = { membres, ajouts, departs, vues, live: asText(r[8]), notes: asText(r[11]) };
  });
  return out;
}
function readLives(rows) {
  const out = {};
  (rows || []).forEach(r => {
    const date = r && asDate(r[0]);
    if (!date) return;
    const heures = asNumber(r[2]) * 24; // durée stockée en fraction de jour
    const viewers = asNumber(r[3]);
    if (!heures && !viewers) return;
    const d = out[date] || (out[date] = { lives: 0, heures: 0, viewers: 0, pic: 0, followers: 0 });
    d.lives += 1; d.heures += heures; d.viewers += viewers;
    d.pic = Math.max(d.pic, asNumber(r[4])); d.followers += asNumber(r[5]);
  });
  return out;
}

// ---------- Agrégats ----------
const round = n => Math.round(n * 100) / 100;
function sumIn(deps, a, b, statut) { return deps.filter(d => inRange(d.date, a, b) && (!statut || d.statut === statut)).reduce((s, d) => s + d.commission, 0); }
function countIn(deps, a, b, statut) { return deps.filter(d => inRange(d.date, a, b) && d.statut === statut).length; }

function monthEconomics(deps, params, month) {
  const ca = sumIn(deps, month.start, month.end, 'debloquee');
  const annulees = sumIn(deps, month.start, month.end, 'annulee');
  const fraisFixes = params.fixes.reduce((s, f) => s + f.usd, 0);
  const fraisVariables = params.variables.reduce((s, v) => s + v.pct * (ca + annulees), 0);
  const frais = fraisFixes + fraisVariables;
  const benefice = ca - frais;
  const partPct = Math.max(0, benefice) * params.pctPartner;
  const partner = Math.max(params.minMensuel, partPct);
  return {
    ca: round(ca), frais: round(frais), fraisFixes: round(fraisFixes), fraisVariables: round(fraisVariables),
    benefice: round(benefice), partner: round(partner), minimumApplique: partner > partPct,
    agence: round(benefice - partner)
  };
}

function statusVsPace(ca, objectif, elapsed, total) {
  if (!objectif) return { code: 'none', label: 'Objectif non défini', diff: 0 };
  const progress = ca / objectif * 100;
  const expected = elapsed / total * 100;
  const diff = progress - expected;
  if (progress >= 100) return { code: 'done', label: 'Objectif atteint', progress, expected, diff };
  if (diff > 5) return { code: 'ahead', label: 'En avance', progress, expected, diff };
  if (diff < -5) return { code: 'behind', label: 'En retard', progress, expected, diff };
  return { code: 'ontrack', label: 'Dans les temps', progress, expected, diff };
}

function dailySeries(deps, funnelTg, funnelLive, start, end) {
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const tg = funnelTg[d] || {}, lv = funnelLive[d] || {};
    days.push({
      date: d,
      ca: round(sumIn(deps, d, d, 'debloquee')),
      attente: round(sumIn(deps, d, d, 'attente')),
      depots: countIn(deps, d, d, 'debloquee'),
      ajouts: tg.ajouts || 0, membres: tg.membres || 0, vues: tg.vues || 0,
      lives: lv.lives || 0, heures: round(lv.heures || 0), viewers: lv.viewers || 0, followers: lv.followers || 0
    });
  }
  return days;
}

// ---------- Anomalies d'un partenaire ----------
function anomaliesFor(deps, today, partnerName) {
  const out = [];
  deps.forEach(d => {
    if (d.statut === 'attente' && daysBetween(d.date, today) > 7)
      out.push({ type: 'attente', gravite: 2, partner: partnerName, date: d.date, name: d.name, broker: d.broker, montant: d.commission,
        texte: 'En attente depuis ' + daysBetween(d.date, today) + ' jours' });
    if (d.statut && d.statutSetter && d.statut !== d.statutSetter)
      out.push({ type: 'conflit', gravite: 2, partner: partnerName, date: d.date, name: d.name, broker: d.broker, montant: d.commission,
        texte: 'Statut « ' + d.statutLabel + ' » mais setter « ' + d.statutSetterLabel + ' »' });
  });
  const seen = {};
  deps.forEach(d => { const k = norm(d.name); (seen[k] = seen[k] || []).push(d); });
  Object.values(seen).filter(g => g.length > 1).forEach(g => {
    out.push({ type: 'doublon', gravite: 3, partner: partnerName, date: g[0].date, name: g[0].name, broker: g.map(x => x.broker).join(' + '),
      montant: g.reduce((s, x) => s + x.commission, 0),
      texte: 'Client saisi ' + g.length + ' fois (' + g.map(x => x.date.slice(8, 10) + '/' + x.date.slice(5, 7) + ' ' + (x.statutLabel || '?')).join(', ') + ')' });
  });
  return out;
}

// ---------- Point d'entrée : un partenaire ----------
async function partnerMetrics(p) {
  const today = todayIso();
  const [fin, tg, live] = await Promise.all([
    readTabs(p.finance, ['Paramètres', ...BROKERS]),
    p.telegram ? readTabs(p.telegram, ['Saisie']).catch(e => ({ _err: String(e.message || e) })) : { _err: 'aucun fichier Telegram' },
    p.live ? readTabs(p.live, ['Saisie']).catch(e => ({ _err: String(e.message || e) })) : { _err: 'aucun fichier Live' }
  ]);
  const sourceIssues = { telegram: tg._err || ((tg.Saisie || []).length ? null : 'onglet Saisie vide'), live: live._err || ((live.Saisie || []).length ? null : 'onglet Saisie vide'),
    telegramRows: (tg.Saisie || []).length, liveRows: (live.Saisie || []).length, sample: (tg.Saisie || []).slice(180, 183) };
  const params = readParams(fin['Paramètres'] || []);
  const deps = readDeposits(fin);
  const funnelTg = readTelegram(tg.Saisie);
  const funnelLive = readLives(live.Saisie);

  const month = monthOf(today), q = quinzaineOf(today), pm = prevMonth(today);
  const objectifMois = params.objectifQuinzaine * 2;
  const monthDays = daysBetween(month.start, month.end) + 1;
  const monthElapsed = daysBetween(month.start, today) + 1;
  const qDays = daysBetween(q.start, q.end) + 1;
  const qElapsed = daysBetween(q.start, today) + 1;

  const eco = monthEconomics(deps, params, month);
  const ecoPrev = monthEconomics(deps, params, pm);
  const caQ = sumIn(deps, q.start, q.end, 'debloquee');

  // Historique : 6 derniers mois et 8 dernières quinzaines
  const historyMonths = [];
  let m = month;
  for (let i = 0; i < 6; i++) {
    const e = monthEconomics(deps, params, m);
    historyMonths.unshift({ key: m.key, start: m.start, end: m.end, ...e, depots: countIn(deps, m.start, m.end, 'debloquee'),
      attente: round(sumIn(deps, m.start, m.end, 'attente')) });
    m = prevMonth(m.start);
  }
  const historyQ = [];
  let qq = q;
  for (let i = 0; i < 8; i++) {
    historyQ.unshift({ key: qq.key, start: qq.start, end: qq.end, payout: qq.payout,
      ca: round(sumIn(deps, qq.start, qq.end, 'debloquee')), attente: round(sumIn(deps, qq.start, qq.end, 'attente')),
      depots: countIn(deps, qq.start, qq.end, 'debloquee') });
    qq = quinzaineOf(addDays(qq.start, -1));
  }

  // Encaissements : quinzaines dont la date de paiement n'est pas encore passée
  const payouts = historyQ.filter(x => x.payout >= today && (x.ca > 0 || x.attente > 0 || x.key === q.key))
    .map(x => ({ key: x.key, start: x.start, end: x.end, date: x.payout, montant: x.ca, attente: x.attente, enCours: x.end >= today }));

  const days30 = dailySeries(deps, funnelTg, funnelLive, addDays(today, -29), today);
  const lastTg = Object.keys(funnelTg).sort().pop();
  const lastLive = Object.keys(funnelLive).sort().pop();

  return {
    partner: { slug: p.slug, name: p.name },
    today,
    params: { objectifQuinzaine: params.objectifQuinzaine, objectifMois, pctPartner: params.pctPartner, minMensuel: params.minMensuel,
      rate: params.rate, fixes: params.fixes, variables: params.variables },
    jour: {
      ca: round(sumIn(deps, today, today, 'debloquee')),
      attente: round(sumIn(deps, today, today, 'attente')),
      hier: round(sumIn(deps, addDays(today, -1), addDays(today, -1), 'debloquee')),
      depots: deps.filter(d => d.date === today)
    },
    mois: {
      key: month.key, start: month.start, end: month.end, jours: monthDays, ecoules: monthElapsed,
      objectif: objectifMois, ...eco,
      attente: round(sumIn(deps, month.start, month.end, 'attente')),
      annulees: round(sumIn(deps, month.start, month.end, 'annulee')),
      depots: countIn(deps, month.start, month.end, 'debloquee'),
      projection: round(eco.ca / monthElapsed * monthDays),
      rythmeNecessaire: round(Math.max(0, objectifMois - eco.ca) / Math.max(1, monthDays - monthElapsed + 1)),
      statut: statusVsPace(eco.ca, objectifMois, monthElapsed, monthDays),
      precedent: { key: pm.key, ...ecoPrev }
    },
    quinzaine: {
      key: q.key, start: q.start, end: q.end, jours: qDays, ecoules: qElapsed, encaissement: q.payout,
      objectif: params.objectifQuinzaine, ca: round(caQ),
      attente: round(sumIn(deps, q.start, q.end, 'attente')),
      depots: countIn(deps, q.start, q.end, 'debloquee'),
      projection: round(caQ / qElapsed * qDays),
      rythmeNecessaire: round(Math.max(0, params.objectifQuinzaine - caQ) / Math.max(1, qDays - qElapsed + 1)),
      statut: statusVsPace(caQ, params.objectifQuinzaine, qElapsed, qDays),
      jours_detail: dailySeries(deps, funnelTg, funnelLive, q.start, q.end)
    },
    funnel: {
      jours: days30,
      derniereSaisieTelegram: lastTg || null,
      derniereSaisieLive: lastLive || null,
      membres: lastTg ? funnelTg[lastTg].membres : 0
    },
    historique: { mois: historyMonths, quinzaines: historyQ },
    encaissements: payouts,
    depots: deps.slice(0, 200).map(d => ({ date: d.date, name: d.name, tg: d.tg, broker: d.broker, setter: d.setter,
      depot: d.depot, commission: d.commission, statut: d.statut, statutLabel: d.statutLabel })),
    anomalies: anomaliesFor(deps, today, p.name),
    sources: sourceIssues,
    _deps: deps
  };
}

// Version vue partenaire : sans marge agence ni détail des frais.
function partnerView(m) {
  const out = JSON.parse(JSON.stringify(m));
  delete out._deps;
  delete out.mois.agence; delete out.mois.precedent.agence;
  out.historique.mois.forEach(x => { delete x.agence; });
  delete out.anomalies;
  delete out.encaissements;
  return out;
}

// Vue agence : tous les partenaires actifs + total + anomalies croisées.
function agencyView(list) {
  const today = todayIso();
  const partners = list.map(m => {
    const v = JSON.parse(JSON.stringify(m)); delete v._deps; return v;
  });
  const anomalies = [].concat(...partners.map(p => p.anomalies));
  // Doublons entre partenaires
  const byName = {};
  list.forEach(m => m._deps.forEach(d => { const k = norm(d.name); (byName[k] = byName[k] || []).push({ p: m.partner.name, d }); }));
  Object.values(byName).forEach(g => {
    const names = [...new Set(g.map(x => x.p))];
    if (names.length > 1) anomalies.push({ type: 'croise', gravite: 3, partner: names.join(' + '), date: g[0].d.date, name: g[0].d.name,
      broker: g.map(x => x.d.broker).join(' + '), montant: g.reduce((s, x) => s + x.d.commission, 0),
      texte: 'Même client chez ' + names.join(' et ') });
  });
  anomalies.sort((a, b) => b.gravite - a.gravite || (a.date < b.date ? 1 : -1));
  const sum = k => round(partners.reduce((s, p) => s + (p.mois[k] || 0), 0));
  const payoutMap = {};
  partners.forEach(p => p.encaissements.forEach(e => {
    const x = payoutMap[e.key] || (payoutMap[e.key] = { key: e.key, date: e.date, start: e.start, end: e.end, enCours: e.enCours, montant: 0, attente: 0, detail: [] });
    x.montant = round(x.montant + e.montant); x.attente = round(x.attente + e.attente);
    x.detail.push({ partner: p.partner.name, montant: e.montant, attente: e.attente });
  }));
  return {
    today,
    total: {
      ca: sum('ca'), objectif: sum('objectif'), attente: sum('attente'), frais: sum('frais'), benefice: sum('benefice'),
      partenaires: sum('partner'), agence: sum('agence'), depots: sum('depots'),
      caJour: round(partners.reduce((s, p) => s + p.jour.ca, 0))
    },
    encaissements: Object.values(payoutMap).sort((a, b) => (a.date < b.date ? -1 : 1)),
    anomalies,
    partners
  };
}

module.exports = { partnerMetrics, partnerView, agencyView, todayIso };

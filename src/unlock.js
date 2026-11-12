/* ================= TOKEN UNLOCKS: calendar + "is supply about to hit this coin?" ================= */
// Source: unlocks.json (researched daily and published next to the desk). The build embeds a snapshot so the desk also
// works as a local file; on github.io it fetches the latest. You can add your own events on the GainerLoser desk.
const UNL_BUILTIN = /*UNLOCKS_JSON*/null;
let UNL = {updated: null, by: '', events: [], from: 'none'};
function unlNorm(e, mine) {
  const b = String(e.b || '').toUpperCase().replace(/USDT$/, '');
  const t = e.t || Date.parse((e.date || '') + (e.time ? 'T' + e.time + 'Z' : 'T00:00:00Z'));
  return Object.assign({}, e, {b, s: b + 'USDT', t, pct: fin(+e.pct) && e.pct !== null && e.pct !== '' ? +e.pct : null, pctTotal: fin(+e.pctTotal) && e.pctTotal !== null && e.pctTotal !== '' ? +e.pctTotal : null, mine: !!mine});
}
function unlSet(j, from) {
  if (!j || !Array.isArray(j.events)) return false;
  UNL = {updated: j.updated || null, by: j.by || '', note: j.note || '', events: j.events.map(e => unlNorm(e)).filter(e => fin(e.t)), from};
  return true;
}
unlSet(UNL_BUILTIN, 'built-in');
async function unlLoad() {
  try {
    if (typeof location !== 'undefined' && /^https?:/.test(location.protocol)) {
      const r = await fetch('unlocks.json', {cache: 'no-store'});
      if (r.ok) { const j = await r.json(); if (!UNL.updated || (j.updated || '') >= UNL.updated) unlSet(j, 'online'); }
    }
  } catch (_) {}
}
function unlAll() { return [...UNL.events, ...(CFG.unl || []).map(e => unlNorm(e, true)).filter(e => fin(e.t))].sort((a, b) => a.t - b.t); }
// how big is it? share of circulating supply; if only % of total is known, a rough stand-in (total ≈ 2–3× circulating for these coins)
function unlSize(e) { return fin(e.pct) ? e.pct : fin(e.pctTotal) ? e.pctTotal * 2.5 : null; }
function unlBig(e, minPct = (typeof PT !== 'undefined' && PT.cfg && PT.cfg.unlMinPct) || 2) { const z = unlSize(e); return z == null ? e.kind === 'cliff' : z >= minPct; }
// the unlock situation for one coin right now: an upcoming event within 14 days, or one that happened in the last 3 days
function unlCtx(s, t = now()) {
  const L = unlAll().filter(e => e.s === s);
  const next = L.find(e => e.t >= t - 3600e3 * 2 && e.t - t <= 14 * 864e5);
  const past = [...L].reverse().find(e => e.t < t - 3600e3 * 2 && t - e.t <= 3 * 864e5);
  if (next) { const h = (next.t - t) / 3600e3; return {phase: 'ahead', e: next, hours: h, days: h / 24, big: unlBig(next)}; }
  if (past) { const h = (t - past.t) / 3600e3; return {phase: 'after', e: past, hours: h, days: h / 24, big: unlBig(past)}; }
  return {phase: null};
}
function unlWhen(u) { if (!u || !u.phase) return ''; const d = u.days; const w = Math.abs(d) < 1 ? Math.round(u.hours) + 'h' : d.toFixed(d < 3 ? 1 : 0) + 'd'; return u.phase === 'ahead' ? 'in ' + w : w + ' ago'; }
function unlSizeTxt(e) { const z = unlSize(e); return fin(e.pct) ? e.pct.toFixed(e.pct < 10 ? 1 : 0) + '% of circulating' : fin(e.pctTotal) ? '~' + z.toFixed(0) + '% of circulating (est.)' : 'size unknown'; }
function unlLabel(u) { return u && u.phase ? `${u.phase === 'ahead' ? 'Unlock' : 'Unlocked'} ${unlWhen(u)} · ${unlSizeTxt(u.e)}` : ''; }
// GainerLoser: warn about big unlocks on coins that matter (movers, tracked, positions, watchlist)
function unlCheck() {
  const t = now(), want = new Set([...S.gainers.slice(0, 10), ...S.losers.slice(0, 10), ...Object.keys(S.trk || {}), ...Object.keys((typeof PT !== 'undefined' && PT.pos) || {}), ...CFG.watch]);
  for (const s of want) {
    const u = unlCtx(s, t); if (!u.phase || !u.big) continue;
    if (u.phase === 'ahead' && u.days <= 3)
      raise('scout', s, 'unl' + u.e.t, `${u.e.b}: token unlock ${unlWhen(u)} (${new Date(u.e.t).toISOString().slice(0, 10)}) · ${unlSizeTxt(u.e)}${u.e.who ? ' · ' + u.e.who : ''}. New supply can weigh on price around it.`, -1, 12 * 3600e3, u.days <= 1);
    if (u.phase === 'after' && u.hours <= 24)
      raise('scout', s, 'unla' + u.e.t, `${u.e.b}: unlock happened ${unlWhen(u)} (${unlSizeTxt(u.e)}). Watch whether the new supply gets sold or absorbed.`, 0, 24 * 3600e3);
  }
}
// the desk refreshes the calendar from the published file every 6 hours (the cloud bot reads it from its checkout instead)
if (typeof window !== 'undefined' && typeof setInterval === 'function') { unlLoad(); setInterval(unlLoad, 6 * 3600e3); }

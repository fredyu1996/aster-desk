// Year backtest report maths. REPORT ONLY and pure: no imports, no network, never changes live rules.
// Spec: docs/superpowers/specs/2026-11-14-smc-year-backtester-design.md
export const MIN_N = 20, MIN_DR = 0.3, MIN_N_CHECK = 8, NOT_HELD_CAP = 10, ABL_DR = 0.2, SIZE_MAX = 900e3;
export const FEATS = ['coin', 'side', 'type', 'tf', 'zone', 'qBand', 'grade', 'regime', 'hour', 'wd', 'atrT', 'mvT', 'rrBand', 'stopBand', 'btc', 'tm'];
const rd = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

export function stats(rows) {
  const n = rows.length;
  if (!n) return {n: 0, avgR: null, win: null, totR: 0, maxDD: 0};
  let tot = 0, peak = 0, dd = 0, w = 0;
  for (const r of [...rows].sort((a, b) => a.t1 - b.t1)) { tot += r.R; if (r.R > 0) w++; peak = Math.max(peak, tot); dd = Math.max(dd, peak - tot); }
  return {n, avgR: rd(tot / n, 3), win: Math.round(100 * w / n), totR: rd(tot, 2), maxDD: rd(dd, 2)};
}

const halves = (rows, tSplit) => ({all: stats(rows), a: stats(rows.filter(r => r.t0 < tSplit)), b: stats(rows.filter(r => r.t0 >= tSplit))});

export function sumRun(rows, tSplit) {
  const by = {};
  for (const r of rows) (by[r.s] ||= []).push(r);
  return {...halves(rows, tSplit), coin: Object.fromEntries(Object.entries(by).map(([s, g]) => [s, stats(g)]))};
}

export function findPatterns(rows, tSplit) {
  const A = rows.filter(r => r.t0 < tSplit), B = rows.filter(r => r.t0 >= tSplit), held = [], notHeld = [];
  const split = (g, f, v) => { const i = g.filter(r => r.f[f] === v), o = g.filter(r => r.f[f] !== v), si = stats(i), so = stats(o); return [{n: si.n, avgR: si.avgR}, {n: so.n, avgR: so.avgR}]; };
  for (const f of FEATS) {
    let vals = [...new Set(rows.map(r => r.f[f]))].filter(v => v !== '?' && v != null).sort();
    if (vals.length === 2) vals = [vals[0]]; // two values mirror each other
    for (const v of vals) {
      const [inA, outA] = split(A, f, v);
      if (inA.n < MIN_N || outA.n < MIN_N) continue;
      const dA = rd(inA.avgR - outA.avgR, 3);
      if (Math.abs(dA) < MIN_DR) continue;
      const [inB, outB] = split(B, f, v), dB = rd(inB.avgR - outB.avgR, 3);
      const p = {f, v, dA, dB: inB.n && outB.n ? dB : null, inA, inB, outA, outB};
      (inB.n >= MIN_N_CHECK && outB.n >= MIN_N_CHECK && Math.sign(dB) === Math.sign(dA) ? held : notHeld).push(p);
    }
  }
  const by = (a, b) => Math.abs(b.dA) - Math.abs(a.dA);
  return {held: held.sort(by), notHeld: notHeld.sort(by).slice(0, NOT_HELD_CAP)};
}

export function ablation(baseRows, runs, tSplit) {
  const base = halves(baseRows, tSplit), d = (x, y) => x == null || y == null ? null : rd(y - x, 3);
  const out = runs.map(({k, lab, rows}) => {
    const sw = halves(rows, tSplit), dAvg = d(base.all.avgR, sw.all.avgR), dA = d(base.a.avgR, sw.a.avgR), dB = d(base.b.avgR, sw.b.avgR);
    const ok = dAvg != null && dA != null && dB != null;
    const label = ok && dAvg >= ABL_DR && dA > 0 && dB > 0 ? 'harmful' : ok && dAvg <= -ABL_DR && dA < 0 && dB < 0 ? 'helpful' : 'none';
    return {k, lab, base, sw, dAvg, dA, dB, dTot: rd(sw.all.totR - base.all.totR, 2), label};
  });
  return out.sort((a, b) => (b.label !== 'none') - (a.label !== 'none') || Math.abs(b.dTot) - Math.abs(a.dTot));
}

export function months(rows) {
  const by = {};
  for (const r of rows) (by[new Date(r.t0).toISOString().slice(0, 7)] ||= []).push(r);
  return Object.keys(by).sort().map(m => ({m, n: by[m].length, avgR: stats(by[m]).avgR}));
}

export function exits(rows) {
  const by = {};
  for (const r of rows) (by[String(r.why).replace(/[\d.]+/g, '#').slice(0, 40)] ||= []).push(r);
  return Object.entries(by).map(([why, g]) => ({why, n: g.length, avgR: stats(g).avgR})).sort((a, b) => b.n - a.n);
}

export function terciles(rows, key, out) {
  const vals = rows.map(r => r.f[key]).filter(v => v != null).sort((a, b) => a - b), m = vals.length;
  for (const r of rows) {
    const v = r.f[key];
    if (v == null) { r.f[out] = '?'; continue; }
    const k = vals.indexOf(v); // first equal value = lowest rank
    r.f[out] = k < m / 3 ? 'low' : k < 2 * m / 3 ? 'mid' : 'high';
  }
}

export function fitSize(file) {
  if (JSON.stringify(file).length <= SIZE_MAX) return file;
  const all = file.trades || [];
  for (const keep of [100, 0]) {
    const per = {}, kept = [];
    for (const r of [...all].sort((a, b) => b.t0 - a.t0)) { per[r.v] = (per[r.v] || 0) + 1; if (per[r.v] <= keep) kept.push(r); }
    file.trades = kept.sort((a, b) => a.t0 - b.t0);
    file.sum = {...file.sum, trimmed: true};
    if (JSON.stringify(file).length <= SIZE_MAX) break;
  }
  return file;
}

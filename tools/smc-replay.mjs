// SMC zone replay (plan 2026-11-13-smc-zone-replay): for every closed SMC trade in a state file
//  1. re-runs the SMC Trader on Aster candles at every 1-minute close from 12 h before the entry, under
//     the current rules ("cur") and under option B ("B": enter only 30–60% into the zone, stop ≥ 2%), and manages the
//     first entry with the trader's own replay exits (stop, half at tp1R → breakeven, target, time stop; worst case first
//     inside a candle; fees + slippage as in the account);
//  2. labels every candidate FVG / OB at the setup right / wrong / untouched (smZoneBackfill → smZoneLabel);
//  3. runs smZoneTune on those labels;
//  4. reports R and zone labels by setup grade (smGrade: read at entry by the backfill; cur-sim: at its own entry).
// Paper replay only: nothing is written back to the state, and the output stays outside the repo.
// Usage: node tools/smc-replay.mjs <state.json> <out.json>   (after build.py; needs network to Aster)
import fs from 'node:fs'; import vm from 'node:vm';
const [, , inF, outF] = process.argv;
if (!inF || !outF) { console.error('usage: node tools/smc-replay.mjs <state.json> <out.json>'); process.exit(2); }
const CORE = fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8');
const st = JSON.parse(fs.readFileSync(inF, 'utf8').replace(/^﻿/, ''));
const LOG = ((st.sm && st.sm.log) || []).filter(x => x.s && x.t0 && x.side);
const mk = () => {
  const ctx = vm.createContext({console, Date, Math, JSON, localStorage: {getItem: () => null, setItem() {}}, document: {querySelector: () => null, getElementById: () => ({addEventListener() {}})}, sayFor() {}, renderPanel() {}, syViewer: () => false, setTimeout, setInterval: () => 0, fetch, URL, navigator: {}, TextEncoder});
  vm.runInContext(CORE, ctx); ctx.__ST = {cfg: (st.sm && st.sm.cfg) || {}, adj: (st.rv && st.rv.smAdj) || {}};
  vm.runInContext(`SM.cfg = Object.assign({}, SM_DEF.cfg, __ST.cfg); RV.smAdj = JSON.parse(JSON.stringify(__ST.adj)); delete RV.smAdj.zone;`, ctx);
  return ctx;
};
const H = 3600e3, M1 = 60e3, M5 = 300e3, M15 = 900e3;
const kl = async (s, iv, start, limit) => {
  for (let a = 0; ; a++) {
    const r = await fetch(`https://fapi.asterdex.com/fapi/v1/klines?symbol=${s}&interval=${iv}&startTime=${start}&limit=${limit}`);
    if (r.ok) return (await r.json()).map(b => [+b[0], +b[1], +b[2], +b[3], +b[4], +b[7], +b[10]]);
    if (a >= 2) throw new Error(`${s} ${iv} HTTP ${r.status}`); await new Promise(z => setTimeout(z, 2000));
  }
};
const agg = (B, t) => B.length ? [t, B[0][1], Math.max(...B.map(b => b[2])), Math.min(...B.map(b => b[3])), B[B.length - 1][4], B.reduce((a, b) => a + b[5], 0), B.reduce((a, b) => a + b[6], 0)] : null;

// one variant on one trade: returns {t, entry, stop, R, exitWhy, dz, zone} for the first entry, or {none: reason}
function sim(x, D, variant) {
  const ctx = mk(), X = c => vm.runInContext(c, ctx), s = x.s, hold = (x.tf === '1h' ? 36 : 12) * H;
  X(`SM.on = true; SM.pos = {}; SM.log = []; SM.cool = {}; warm = true; S.started = 0;
     S.meta.set(${JSON.stringify(s)}, {base: ${JSON.stringify(x.b || s.replace(/USDT$/, ''))}}); S.fund.set(${JSON.stringify(s)}, {r: 0});`);
  if (variant === 'B') X(`SM.cfg.minStopPct = 2; delete RV.smAdj.needDepth;
     { const rd = smcRead; smcRead = s => { const r = rd(s); if (r.stage === 'inzone' && !(r.q && r.q.dz >= 0.3 && r.q.dz <= 0.6)) { r.stage = 'mss'; r.st = SMST.mss; } return r; }; }`);
  let atT0 = null;
  // a step at each 1m close (the forming 15m / 1h built from 1m), plus one at the real entry moment: that minute so far, at the entry price
  const steps = [], sl = (((st.sm && st.sm.cfg) || {}).slipPct ?? 0.1) / 100, px0 = x.entry / (x.side === 'L' ? 1 + sl : 1 - sl);   // the price before the fill's slippage
  D.m1.forEach((b, i) => { const f = D.m1.slice(Math.max(0, i - 60), i + 1);
    if (b[0] <= x.t0 && x.t0 < b[0] + M1) steps.push([x.t0, f.slice(0, -1).concat([[b[0], b[1], Math.max(b[1], px0), Math.min(b[1], px0), px0, 0, 0]])]);
    steps.push([b[0] + M1, f]); });
  for (const [T, f1] of steps) {
    const last = f1[f1.length - 1];
    const b15 = D.m15.filter(b => b[0] + M15 <= T), fo15 = agg(f1.filter(b => b[0] >= Math.floor(T / M15) * M15), Math.floor(T / M15) * M15);
    const h1 = D.h1.filter(b => b[0] + H <= T), fo1 = agg(f1.filter(b => b[0] >= Math.floor(T / H) * H), Math.floor(T / H) * H);
    ctx.__D = {s, k: b15.concat(fo15 ? [fo15] : []).slice(-96), h: h1.concat(fo1 ? [fo1] : []).slice(-72), live: last[4], T, side: x.side};
    const took = X(`(() => { const D = __D; CLOCK_OVR = D.T; S.kl.set(D.s, {t: D.T, bars: D.k}); S.h1.set(D.s, {t: D.T, bars: D.h});
      S.tk.set(D.s, {last: D.live, pct: D.side === 'S' ? 12 : -12, qv: 1e9}); S.trk = {[D.s]: {side: D.side === 'S' ? 'G' : 'L', t0: D.T - 3600e3, px0: D.live, rank: 1}};
      S.smC.clear(); smTick(); const p = SM.pos[D.s]; CLOCK_OVR = 0; return p && p.side === D.side ? 1 : 0; })()`);
    if (!atT0 && T >= x.t0) atT0 = X(`(() => { const r = S.smC.get(__D.s) || {}, c = ((SM.lastScan || {}).cands || [])[0]; return r.stage + (c && c.skip ? ': ' + c.skip : ''); })()`);   // why it did or didn't trade at the real entry time
    if (!took) { if (Object.keys(X('SM.pos')).length) X('SM.pos = {}'); continue; }
    // manage on the 1m, then 5m candles after the entry, as the cloud replays them (adverse extreme first)
    const e1 = D.m1.length ? D.m1[D.m1.length - 1][0] + M1 : T;
    ctx.__RP = {s, bars: D.m1.filter(b => b[0] >= T).map(b => [...b.slice(0, 5), M1]).concat(D.m5.filter(b => b[0] >= Math.max(T, e1) && b[0] <= T + hold + H).map(b => [...b.slice(0, 5), M5]))};
    X(`(() => { const {s, bars} = __RP;
      for (const [t0, o, h, l, c, len] of bars) { const p = SM.pos[s]; if (!p) break; CLOCK_OVR = t0 + len - 1;
        const L = p.side === 'L', path = L ? [o, l, h, c] : [o, h, l, c]; let prev = o;
        for (const v of path) { const q = SM.pos[s]; if (!q) break; const d = Math.abs(q.entry - q.stop0), dir = L ? 1 : -1;
          const lv = [q.stop, q.tp1 ? null : q.entry + dir * (q.tp1R || SM.cfg.tp1R) * d, q.target].filter(z => z != null && isFinite(z));
          const pts = lv.filter(z => (z - prev) * (z - v) <= 0 && z !== prev).sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
          for (const z of [...pts, v]) { if (!SM.pos[s]) break; PX_OVR = {[s]: z}; smManage(CLOCK_OVR, s); } prev = v; } }
      if (SM.pos[s]) { PX_OVR = {[s]: bars[bars.length - 1][4]}; smClose(s, 1, 'end of candles'); }
      PX_OVR = null; CLOCK_OVR = 0; })()`);
    const r = X('SM.log[0]');
    return {t: T, dt: Math.round((T - x.t0) / 60e3), entry: r.entry, stop: r.stop0, stopPct: +(Math.abs(r.entry - r.stop0) / r.entry * 100).toFixed(2), R: +r.R.toFixed(3), exitWhy: r.exitWhy,
      zone: r.zone, dz: r.q ? r.q.dz : null, tf: r.tf, grd: r.grd || null};
  }
  return {none: 'no entry from 12 h before to 1 h after the real entry', atT0};
}

const out = [];
for (const x of LOG) {
  const row = {s: x.s, side: x.side, tf: x.tf || '15m', type: x.type, t0: x.t0, zoneKind: x.zoneKind, actual: {R: +(+x.R).toFixed(3), exitWhy: x.exitWhy, stopPct: +(Math.abs(x.entry - x.stop0) / x.entry * 100).toFixed(2)}};
  try {
    const hold = (x.tf === '1h' ? 36 : 12) * H;
    const D = {m1: await kl(x.s, '1m', x.t0 - 12 * H, 13 * 60), m5: await kl(x.s, '5m', x.t0 - 13 * H, Math.min(1500, (13 * H + hold + 3 * H) / M5)),
      m15: await kl(x.s, '15m', x.t0 - 12 * H - 26 * M15 * 4, 12 * 4 + 104 + 8), h1: await kl(x.s, '1h', x.t0 - 12 * H - 74 * H, 90)};
    row.cur = sim(x, D, 'cur'); row.B = sim(x, D, 'B');
  } catch (e) { row.err = String(e.message || e); }
  out.push(row); process.stderr.write('.');
}
process.stderr.write('\n');

// zone labels: the Reviewer's own backfill on copies of the rows (clock moved past the 48 h wait; candles end at the real now)
const zctx = mk(), ZX = c => vm.runInContext(c, zctx);
zctx.__L = JSON.parse(JSON.stringify(LOG)).map(x => { delete x.zc; delete x.zcSkip; delete x.zcErr; return x; });
ZX(`SM.log = __L; CLOCK_OVR = Date.now() + 49 * 3600e3;`);
for (let i = 0; i < 4 && ZX('SM.log.some(x => !(x.zc && x.zc.done) && !x.zcSkip)'); i++) { ZX('SM.log.forEach(x => { x.zcErr = 0; })'); await ZX('smZoneBackfill(1000)'); }
ZX('CLOCK_OVR = 0');
const ZL = ZX('SM.log'), tune = ZX('smZoneTune(SM.log)');
ZL.forEach((z, i) => {
  const r = out[i]; if (!z.zc) { r.zones = {skip: z.zcSkip || (/closed by you/.test(z.exitWhy || '') ? 'closed by Fred (left out)' : 'candles not fetched')}; return; }
  const c = z.zc.c, k = z.zc.k, oth = c.filter((_, j) => j !== k).sort((a, b) => (b.r || 0) - (a.r || 0))[0] || null;
  r.grd = z.grd || null;
  r.zones = {k, chosen: c[k] ? {kind: c[k].kind, lab: c[k].lab, r: c[k].r} : null, bestOther: oth ? {kind: oth.kind, lab: oth.lab, r: oth.r} : null, c};
});

// ---- summary
const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(2);
const sumLine = (name, R) => `${name.padEnd(8)} n ${String(R.length).padStart(2)}  wins ${String(R.filter(v => v > 0).length).padStart(2)}  avg R ${R.length ? fmt(R.reduce((a, b) => a + b, 0) / R.length) : '—'}  sum R ${fmt(R.reduce((a, b) => a + b, 0))}`;
// a sim entry can fall in two trades' windows (same coin, < 12 h apart): count each simulated entry once
const uniq = k => [...new Map(out.filter(r => r[k] && !r[k].none).map(r => [r.s + ':' + r[k].t, r[k].R])).values()];
const lines = [sumLine('actual', out.map(r => r.actual.R)), sumLine('cur-sim', uniq('cur')), sumLine('B-sim', uniq('B'))];
const same = out.filter(r => r.cur && !r.cur.none && Math.abs(r.cur.dt) <= 30), gap = same.map(r => Math.abs(r.cur.R - r.actual.R));
lines.push(`sim-vs-actual: mean |cur-sim R − actual R| ${gap.length ? (gap.reduce((a, b) => a + b, 0) / gap.length).toFixed(2) : '—'}R over the ${same.length} trades the cur-sim re-entered (±30 min of the real entry); not re-entered ${out.length - same.length - out.filter(r => r.err).length} (of which ${out.filter(r => r.cur && !r.cur.none && Math.abs(r.cur.dt) > 30).length} entered the same coin at another time); errors ${out.filter(r => r.err).length}`);
{ const why = {}; for (const r of out) if (r.cur && (r.cur.none || Math.abs(r.cur.dt) > 30)) { const k = String((r.cur.none ? r.cur.atT0 : 'entered ' + r.cur.dt + ' min off') || 'no read').replace(/[\d.]+/g, '#').slice(0, 60); why[k] = (why[k] || 0) + 1; }
  lines.push('cur-sim, no re-entry, state at the real entry time: ' + Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${k}`).join(' | ')); }
const C = out.flatMap(r => r.zones && r.zones.c ? r.zones.c : []);
for (const k of ['FVG', 'OB']) { const A = C.filter(z => z.kind === k); lines.push(`zones ${k.padEnd(3)}: right ${A.filter(z => z.lab === 'right').length}, wrong ${A.filter(z => z.lab === 'wrong').length}, untouched ${A.filter(z => z.lab === 'untouched').length} (of ${A.length})`); }
const Zr = out.filter(r => r.zones && r.zones.c);
lines.push(`chosen zone right ${Zr.filter(r => r.zones.chosen && r.zones.chosen.lab === 'right').length}/${Zr.length}; best other candidate right ${Zr.filter(r => r.zones.bestOther && r.zones.bestOther.lab === 'right').length}/${Zr.length} (${Zr.filter(r => r.zones.bestOther).length} trades had another candidate; traded zone not among candidates ${Zr.filter(r => r.zones.k < 0).length}; skipped ${out.length - Zr.length})`);
lines.push(`smZoneTune: ${tune ? tune.why.map(w => `${w.k} ${fmt(w.r1)} (n ${w.n1}) vs ${fmt(w.r2)} (n ${w.n2})`).join('; ') + ' → W ' + JSON.stringify(tune.W) : 'null (no split passes the gate: each side n ≥ 5, gap ≥ 0.5R, winner > 0)'}`);
{ const G = ['A+', 'A', 'B', 'REJ', '—'], gOf = g => g ? g.g : '—', R2 = A => A.length ? fmt(A.reduce((a, b) => a + b, 0) / A.length) : '—';
  for (const g of G) { const A = out.filter(r => gOf(r.grd) === g), ch = A.map(r => r.zones && r.zones.chosen).filter(Boolean), S = [...new Map(out.filter(r => r.cur && !r.cur.none && gOf(r.cur.grd) === g).map(r => [r.s + ':' + r.cur.t, r.cur.R])).values()];
    lines.push(`grade ${g.padEnd(3)}: actual n ${String(A.length).padStart(2)} avg R ${R2(A.map(r => r.actual.R))} · chosen zone right ${ch.filter(c => c.lab === 'right').length} wrong ${ch.filter(c => c.lab === 'wrong').length} untouched ${ch.filter(c => c.lab === 'untouched').length} · cur-sim n ${S.length} avg R ${R2(S)}`); }
  const why = {}; for (const r of out) for (const c of (r.grd && r.grd.why) || []) why[c] = (why[c] || 0) + 1;
  lines.push('grade reason codes (actual trades): ' + Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')); }
fs.writeFileSync(outF, JSON.stringify({summary: lines, tune, trades: out}, null, 1));
console.log(lines.join('\n')); console.log(`→ ${outF}`);

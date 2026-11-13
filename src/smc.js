/* ================= SMC TRADER: a second paper trader using Smart Money Concepts on the top-5 movers ================= */
// Separate $1,000 paper account so it can be compared with the Trader on equal terms (same risk, fees, slippage,
// unlock guard and coin universe). The setup, read from 15m candles with a 1h structure bias:
//   1. liquidity sweep: a wick takes out a prior swing low (sell-side liquidity) or swing high (buy-side) and closes back inside
//   2. market structure shift (CHoCH): a close beyond the last opposite swing after the sweep
//   3. entry zone: the fair value gap (FVG) left by that displacement, or the order block (last opposite candle) if there is no gap
//   4. entry on the first pullback into the zone; stop beyond the sweep extreme; target = the next liquidity pool (≥ 2R)
// Two timeframes (Nov 9, Fred): setups on 15m candles are only taken when the 1h structure isn't against them, and setups on
// 1h candles only when the 4h structure isn't against them ("if 1h is dropping, no long on 15m; if 4h is dropping, no long on 1h").
// Every setup is also audited in SMC terms (sweep, liquidity, break, FVG / OB quality, premium/discount, higher timeframe,
// entry depth) into a quality score; weak setups are skipped.
const SM_DEF = {v: 1, start: 1000, cash: 1000, pos: {}, log: [], eqs: [], day: null, cool: {}, on: true, paused: null, created: 0, lastScan: null,
  cfg: {riskPct: 1, maxPos: 3, maxLev: 10, minScore: 4, dailyLossPct: 3, feePct: 0.04, slipPct: 0.10, holdH: 12, minVol: 300000, maxStopPct: 15, minRR: 2, maxRR: 5, tp1R: 1.5, stopBuf: 0.3, unlGuard: 1, useScreens: 0, tf15: 1, tf1h: 1, holdH1h: 36, minQ: 55, learn: 1, poiRule: 1, ltfConfirm: 1, roomCheck: 1, cont: 1, pathCheck: 1, pdLiq: 1, invExit: 1, minStopPct: 1.5, minDepth: 15}};
// Nov 8: the SMC Trader trades on its own SMC judgement, without the Reviewer's screens (one-time switch-off for saved accounts)
function smMigrate(p) { if (p.cfg.ownJudge !== 1) { p.cfg.useScreens = 0; p.cfg.ownJudge = 1; } if (p.cfg.lev10 !== 1) { p.cfg.maxLev = 10; p.cfg.lev10 = 1; } // Nov 11 (Fred): 10× leverage cap
  if (p.cfg.pause1113 !== 1) { p.on = false; p.cfg.pause1113 = 1; } // Nov 12 (Fred): stop new SMC entries for the self-review; resume by hand
  return p; }
let SM = (() => {
  const saved = LS.get('awx_sm', null);
  const p = Object.assign(JSON.parse(JSON.stringify(SM_DEF)), saved || {});
  p.cfg = Object.assign({}, SM_DEF.cfg, (saved && saved.cfg) || {});
  if (!p.created) p.created = now();
  return smMigrate(p);
})();
function smSave() { LS.set('awx_sm', SM); }
function smReset() { const cfg = SM.cfg; SM = JSON.parse(JSON.stringify(SM_DEF)); SM.cfg = cfg; SM.created = now(); smSave(); }
S.smC = new Map();

/* ---- chart reading ---- */
// swing highs/lows (fractals): higher/lower than `L` bars on each side
function smPivots(B, L = 2) {
  const H = [], Lo = [];
  for (let i = L; i < B.length - L; i++) {
    let ph = true, pl = true;
    for (let k = 1; k <= L; k++) { if (!(B[i][2] > B[i - k][2] && B[i][2] >= B[i + k][2])) ph = false; if (!(B[i][3] < B[i - k][3] && B[i][3] <= B[i + k][3])) pl = false; }
    if (ph) H.push({i, px: B[i][2], t: B[i][0]}); if (pl) Lo.push({i, px: B[i][3], t: B[i][0]});
  }
  return {H, L: Lo};
}
const SM_TF = {'15m': {ms: 15 * 60e3, htf: '1h', min: 40}, '1h': {ms: 3600e3, htf: '4h', min: 30}};
// 4h candles built from the 1h ones (72 h → 18 bars, enough to read the 4h structure)
function smAgg(B, hrs) {
  const out = [], ms = hrs * 3600e3;
  for (const b of B) { const t = Math.floor(b[0] / ms) * ms, o = out[out.length - 1]; if (o && o[0] === t) { o[2] = Math.max(o[2], b[2]); o[3] = Math.min(o[3], b[3]); o[4] = b[4]; o[5] += b[5]; } else out.push([t, b[1], b[2], b[3], b[4], b[5]]); }
  return out;
}
let SM_OVR = null;   // {s, '15m': bars, '1h': bars, tk, t}: the Reviewer's after-the-fact audit of a past trade
function smBars(s, tf) { if (SM_OVR && SM_OVR.s === s) return tf === '4h' ? smAgg(SM_OVR['1h'], 4) : SM_OVR[tf]; if (tf === '15m') { const k = S.kl.get(s); return k ? k.bars : null; } const h = S.h1.get(s); if (!h) return null; return tf === '1h' ? h.bars : smAgg(h.bars, 4); }
// market structure on a timeframe: the side of the last break of structure (close beyond a confirmed swing)
function smBias(s, tf = '1h') { return smBiasB(smBars(s, tf)); }
function smBiasB(B) {
  if (!B || B.length < 12) return null;
  const P = smPivots(B, 2); let lastH = null, lastL = null, trend = null, hi = 0, li = 0;
  for (let i = 0; i < B.length; i++) {
    while (hi < P.H.length && P.H[hi].i + 2 <= i) lastH = P.H[hi++];
    while (li < P.L.length && P.L[li].i + 2 <= i) lastL = P.L[li++];
    const c = B[i][4];
    if (lastH && c > lastH.px) { trend = 'bull'; lastH = null; } else if (lastL && c < lastL.px) { trend = 'bear'; lastL = null; }
  }
  return trend;
}
/* ---- HTF regime (Nov 12, Fred): read the higher timeframe first, then take only the matching play ----
   B = closed HTF bars only (the caller drops the forming bar). From the last two swing highs H1, H2 and lows L1, L2:
   up = HH + HL with the close above L2; down = LH + LL with the close below H2; anything else = range [lowest low, highest high].
   fakeout = within the last 3 bars a close beyond the last swing high/low formed before them, and the latest close back inside.
   Precedence: fakeout > trend > range. Too few bars or swings → null (no trade). */
function smRegime(B) {
  const no = why => ({reg: null, hi: null, lo: null, why});
  if (!B || B.length < 12) return no('too few closed bars');
  const n = B.length, c = B[n - 1][4], P = smPivots(B, 2);
  if (P.H.length < 2 || P.L.length < 2) return no('too few swings');
  const [H1, H2] = P.H.slice(-2), [L1, L2] = P.L.slice(-2), hi = Math.max(H1.px, H2.px), lo = Math.min(L1.px, L2.px);
  // levels from swings formed before the 3-bar window, so a fakeout bar that became a swing itself still counts as the fakeout
  const lh = P.H.filter(p => p.i < n - 3).pop(), ll = P.L.filter(p => p.i < n - 3).pop();
  for (let m = n - 2; m >= n - 3; m--) {
    if (lh && B[m][4] > lh.px && c <= lh.px) return {reg: 'fakeout_up', hi, lo, why: `closed above ${fmtPx(lh.px)} then back below it`};
    if (ll && B[m][4] < ll.px && c >= ll.px) return {reg: 'fakeout_dn', hi, lo, why: `closed below ${fmtPx(ll.px)} then back above it`};
  }
  if (H2.px > H1.px && L2.px > L1.px && c > L2.px) return {reg: 'up', hi, lo, why: 'higher highs and higher lows'};
  if (H2.px < H1.px && L2.px < L1.px && c < H2.px) return {reg: 'down', hi, lo, why: 'lower highs and lower lows'};
  return {reg: 'range', hi, lo, why: `range ${fmtPx(lo)}–${fmtPx(hi)}`};
}
// does a trade in direction `dir` at price `px` fit the regime (a smRegime result, or just its name)?
function smRegimeOk(reg, dir, px) {
  const R = typeof reg === 'string' ? {reg} : reg || {}, g = R.reg, L = dir === 'L', side = L ? 'long' : 'short';
  if (!g) return {ok: false, play: null, why: 'regime unclear' + (R.why ? ` (${R.why})` : '')};
  if (g === 'up' || g === 'down') { const ok = (g === 'up') === L; return {ok, play: ok ? 'trend' : null, why: ok ? `trending ${g}: ${side} with the trend` : `trending ${g}: no ${side}s against it`}; }
  if (g === 'fakeout_up' || g === 'fakeout_dn') { const ok = (g === 'fakeout_dn') === L; return {ok, play: ok ? 'fakeout' : null, why: ok ? `failed break ${g === 'fakeout_up' ? 'above' : 'below'} the range: ${side} the fakeout` : `failed break ${g === 'fakeout_up' ? 'above' : 'below'} the range: no ${side}s`}; }
  const pos = (px - R.lo) / (R.hi - R.lo), ok = fin(pos) && (L ? pos >= 0 && pos <= 0.3 : pos >= 0.7 && pos <= 1);
  return {ok, play: ok ? 'range' : null, why: fin(pos) ? `range, price at ${Math.round(pos * 100)}%: ${side}s only in the ${L ? 'lower' : 'upper'} 30%` : 'range edges unknown'};
}
// one direction's most recent setup on 15m bars
// how far into a zone a candle must reach to count as having tested it: the depth an entry needs
// (the Reviewer's midpoint rule, else the "not at the very edge" setting); stacked-gap (breakaway) zones are taken at the edge
function smTapDepth(z) { return z && z.bg ? 0 : smRules().needDepth ? 0.5 : (SM.cfg.minDepth || 0) / 100; }
/* ---- zone candidates (Nov 13, Fred): every FVG on the displacement leg plus the order block, with the features the Reviewer
   tunes the pick on. SMZ_DEF reproduces the old pick (FVG over OB, newest first); a learned smRules().zone overrides it. */
const SMZ_DEF = {fvg: 100, pos: 1, fresh: 0, pd: 0, ovl: 0, big: 0, minZs: 0};
const smR6 = v => fin(v) ? +v.toFixed(6) : null;
function smZones(B, st, dir) {
  const n = B.length, bull = dir === 'L', j = st.j, k = st.k, Z = [];
  for (let i = Math.min(k + 1, n - 2); i >= j + 1; i--)
    if (bull ? B[i - 1][2] < B[i + 1][3] : B[i - 1][3] > B[i + 1][2]) Z.push(bull ? {kind: 'FVG', lo: B[i - 1][2], hi: B[i + 1][3], i} : {kind: 'FVG', lo: B[i + 1][2], hi: B[i - 1][3], i});
  let o = st.type === 'cont' ? j : -1;   // continuation: the base candle; reversal: the last opposite candle before the shift
  if (o < 0) for (let i = k - 1; i >= j; i--) { const down = B[i][4] < B[i][1]; if (bull ? down : !down) { o = i; break; } }
  if (o >= 0) Z.push(bull ? {kind: 'OB', lo: B[o][3], hi: B[o][1], i: o} : {kind: 'OB', lo: B[o][1], hi: B[o][2], i: o});
  const atr = smATR(B, j) || (B[j][2] - B[j][3]) || 1e-9, vb = B.slice(Math.max(0, j - 24), j), vAvg = vb.length ? vb.reduce((a, b) => a + b[5], 0) / vb.length : 0;
  let far = st.ext; for (let m = j; m <= Math.min(k + 2, n - 1); m++) far = bull ? Math.max(far, B[m][2]) : Math.min(far, B[m][3]);
  const half = (st.ext + far) / 2, ord = Z.map(z => z.i).sort((a, b) => a - b), ob = Z.find(z => z.kind === 'OB');
  for (const z of Z) {
    const d = B[z.kind === 'FVG' ? z.i : Math.min(z.i + 1, n - 1)], mid = (z.lo + z.hi) / 2;   // the gap candle; for an OB the departure candle
    let fresh = 1; for (let m = Math.max(k + 1, z.i + 2); m < n - 1; m++) if (bull ? B[m][3] <= z.hi : B[m][2] >= z.lo) { fresh = 0; break; }
    Object.assign(z, {zs: smR6((z.hi - z.lo) / atr), body: smR6(Math.abs(d[4] - d[1]) / Math.max(1e-12, d[2] - d[3])), vr: vAvg ? smR6(d[5] / vAvg) : null, fresh,
      pos: ord.indexOf(z.i), dSw: smR6(Math.abs(mid - st.ext) / atr),
      ovl: +(z.kind === 'FVG' ? !!ob && z.lo <= ob.hi && z.hi >= ob.lo : Z.some(f => f.kind === 'FVG' && f.lo <= z.hi && f.hi >= z.lo)),
      pd: +(bull ? mid <= half : mid >= half)});   // in the discount (long) / premium (short) half of the leg
  }
  return Z;
}
function smZoneScore(z, W) { W = Object.assign({}, SMZ_DEF, W); return (z.kind === 'FVG' ? W.fvg : 0) + W.pos * z.pos + W.fresh * z.fresh + W.pd * z.pd + W.ovl * z.ovl + W.big * (z.zs >= 0.3 ? 1 : 0); }
// index of the chosen zone (-1: none); if a tuned minimum size leaves no zone, the default pick (tuning never turns a setup into "no zone")
function smZonePick(Z, W) {
  const best = (A, w) => A.reduce((b, z) => b < 0 || smZoneScore(z, w) > smZoneScore(Z[b], w) ? Z.indexOf(z) : b, -1);
  const ok = Z.filter(z => !(z.zs < ((W && W.minZs) || 0)));
  return ok.length ? best(ok, W) : best(Z, SMZ_DEF);
}
// the chosen candidate as the setup's zone, plus the candidate list (zc) that positions and log rows keep for the Reviewer
function smZoneSet(r, Z) {
  const kz = smZonePick(Z, smRules().zone), nG = Z.filter(z => z.kind === 'FVG').length; if (kz < 0) return;
  const c = Z[kz]; r.zone = {lo: c.lo, hi: c.hi, kind: c.kind, i: c.i}; r.nGaps = nG; r.zc = {c: Z, k: kz};
  if (kz === 0 && c.kind === 'FVG' && nG >= 2) r.zone.bg = true;   // the move left stacked gaps: a breakaway move; the newest gap may never fill deeply
}
function smSetup(B, P, dir, live) {
  const n = B.length, bull = dir === 'L';
  for (let j = n - 1; j >= Math.max(n - 32, 3); j--) {
    const pool = (bull ? P.L : P.H).filter(p => p.i + 2 <= j && p.i >= j - 48);
    const hit = pool.filter(p => bull ? (B[j][3] < p.px && B[j][4] > p.px) : (B[j][2] > p.px && B[j][4] < p.px));
    if (!hit.length) continue;
    const swept = hit.reduce((a, b) => bull ? (b.px < a.px ? b : a) : (b.px > a.px ? b : a));
    const opp = (bull ? P.H : P.L).filter(p => p.i < j && p.i + 2 <= j);
    if (!opp.length) continue;
    const lvl = opp[opp.length - 1];
    let k = -1; for (let m = j + 1; m < n; m++) if (bull ? B[m][4] > lvl.px : B[m][4] < lvl.px) { k = m; break; }
    const end = k < 0 ? n - 1 : k;
    let ext = bull ? Infinity : -Infinity; for (let m = j; m <= end; m++) ext = bull ? Math.min(ext, B[m][3]) : Math.max(ext, B[m][2]);
    const r = {dir, j, k, swept, lvl, ext, stage: k < 0 ? 'sweep' : 'mss', zone: null, taps: 0};
    if (k < 0) { if (bull ? live < ext : live > ext) r.stage = 'none'; return r; }
    // entry zone: the best-scoring FVG / order block on the displacement leg (by default the newest FVG, else the order block)
    smZoneSet(r, smZones(B, r, dir));
    if (!r.zone) { r.stage = 'nozone'; return r; }
    // after the shift: broken (closed through the zone) / tapped before / in the zone now
    // (a candle that only wicked the zone's edge, short of the depth an entry needs, hasn't used the zone)
    r.touch = -1; const zh = r.zone.hi - r.zone.lo, dep = smTapDepth(r.zone);
    for (let m = Math.max(k + 1, r.zone.i + 2); m < n; m++) {
      if (bull ? B[m][4] < r.zone.lo : B[m][4] > r.zone.hi) { r.stage = 'invalid'; return r; }
      if (bull ? B[m][3] <= r.zone.hi : B[m][2] >= r.zone.lo) { if (r.touch < 0) r.touch = m; if (m < n - 1 && (bull ? B[m][3] <= r.zone.hi - dep * zh : B[m][2] >= r.zone.lo + dep * zh)) r.taps++; }
    }
    const inZone = bull ? live <= r.zone.hi * 1.002 && live >= r.zone.lo : live >= r.zone.lo * 0.998 && live <= r.zone.hi;
    r.stage = inZone && !r.taps ? 'inzone' : r.taps ? 'spent' : 'mss';
    return r;
  }
  return null;
}
/* ---- continuation setups (Rally-Base-Rally / Drop-Base-Drop, from the SMC thesis) ----
   With the trend: the entry timeframe was already trending this way, price paused in a base, then broke structure again
   (a close beyond the last swing) with an impulsive move of 1.5+ ATR. The zone is the base (the last opposite candle before
   the move) or the gap the move left; entry on the first pullback into it. Only taken when the higher timeframe agrees. */
function smContSetup(B, P, dir, live) {
  const n = B.length, bull = dir === 'L', want = bull ? 'bull' : 'bear';
  for (let k = n - 1; k >= Math.max(n - 32, 8); k--) {
    const sw = (bull ? P.H : P.L).filter(p => p.i + 2 <= k);
    if (!sw.length) continue;
    const lvl = sw[sw.length - 1];
    if (!(bull ? B[k][4] > lvl.px && B[k - 1][4] <= lvl.px : B[k][4] < lvl.px && B[k - 1][4] >= lvl.px)) continue;
    if (smBiasB(B.slice(0, k)) !== want) continue;                           // the trend was already this way: a continuation, not a change of character
    let i = -1; for (let m = k - 1; m >= Math.max(1, k - 8); m--) if (bull ? B[m][4] < B[m][1] : B[m][4] > B[m][1]) { i = m; break; }
    if (i < 0) continue;                                                       // no base before the break
    let ext = bull ? Infinity : -Infinity; for (let m = i; m <= k; m++) ext = bull ? Math.min(ext, B[m][3]) : Math.max(ext, B[m][2]);
    let leg = bull ? -Infinity : Infinity; for (let m = i + 1; m <= Math.min(k + 2, n - 1); m++) leg = bull ? Math.max(leg, B[m][2]) : Math.min(leg, B[m][3]);
    const atr = smATR(B, i) || 1e-9;
    if (Math.abs(leg - ext) < 1.5 * atr) continue;                            // not an impulsive departure from the base
    const r = {dir, type: 'cont', j: i, k, swept: null, lvl, ext, leg, stage: 'mss', zone: null, taps: 0, touch: -1};
    smZoneSet(r, smZones(B, r, dir));   // the gap the move left, else the base candle (by default)
    const zh = r.zone.hi - r.zone.lo, dep = smTapDepth(r.zone);
    for (let m = Math.max(k + 1, r.zone.i + 2); m < n; m++) {
      if (bull ? B[m][4] < r.zone.lo : B[m][4] > r.zone.hi) { r.stage = 'invalid'; return r; }
      if (bull ? B[m][3] <= r.zone.hi : B[m][2] >= r.zone.lo) { if (r.touch < 0) r.touch = m; if (m < n - 1 && (bull ? B[m][3] <= r.zone.hi - dep * zh : B[m][2] >= r.zone.lo + dep * zh)) r.taps++; }
    }
    const inZone = bull ? live <= r.zone.hi * 1.002 && live >= r.zone.lo : live >= r.zone.lo * 0.998 && live <= r.zone.hi;
    r.stage = inZone && !r.taps ? 'inzone' : r.taps ? 'spent' : 'mss';
    return r;
  }
  return null;
}
const SMST = {
  none: {l: 'No setup', c: DIM, code: 0}, sweep: {l: 'Liquidity swept, waiting for a structure shift', c: WARN, code: 1},
  mss: {l: 'Structure shifted, waiting for the pullback into the zone', c: '#ffb547', code: 2}, confirm: {l: 'In the 1h zone, waiting for a 15m structure shift (lower-timeframe confirmation)', c: '#ffd166', code: 2.5}, inzone: {l: 'In the zone: entry', c: UP, code: 3},
  spent: {l: 'Zone already used', c: DIM, code: 0}, nozone: {l: 'Shifted, but left no gap or order block to enter from', c: DIM, code: 0}, invalid: {l: 'Zone broken', c: DIM, code: 0}, wait: {l: 'Loading', c: DIM, code: -1},
};
/* ---- higher-timeframe supply & demand (from the SMC thesis Fred shared, Nov 9) ----
   A demand zone is the last down candle (the base) before an impulsive rally: the rally runs 1.5+ ATR within 3 candles
   or leaves an imbalance. Supply is the mirror. A zone is dead once a candle closes through it; it is fresh until price
   comes back to it. Lower-timeframe reversals are taken from these zones (points of interest); the opposing zone is
   where the move is likely to stall, so the target must clear it. */
function smZonesB(HB) {
  const out = {D: [], S: [], atr: null, P: null};
  if (!HB || HB.length < 8) return out;
  const n = HB.length, atr = smATR(HB, n) || 1e-9; out.atr = atr; out.P = smPivots(HB, 1); out.mid = (Math.max(...HB.map(b => b[2])) + Math.min(...HB.map(b => b[3]))) / 2;
  for (let i = 1; i < n - 2; i++) for (const bull of [true, false]) {
    const b = HB[i], nb = HB[i + 1];
    if (bull ? !(b[4] < b[1]) : !(b[4] > b[1])) continue;              // the base: last opposite candle
    if (bull ? !(nb[4] > nb[1]) : !(nb[4] < nb[1])) continue;           // the departure starts on the next candle
    const nx = HB.slice(i + 1, i + 4), far = bull ? Math.max(...nx.map(x => x[2])) - b[2] : b[3] - Math.min(...nx.map(x => x[3]));
    const gap = i + 2 < n && (bull ? b[2] < HB[i + 2][3] : b[3] > HB[i + 2][2]);
    if (far < 1.5 * atr && !gap) continue;
    const z = bull ? {lo: b[3], hi: Math.max(b[1], b[4]), side: 'D'} : {lo: Math.min(b[1], b[4]), hi: b[2], side: 'S'};
    Object.assign(z, {i, t: b[0], far: far / atr, gap, broke: null, touches: []});
    for (let m = i + 2; m < n; m++) {
      if (bull ? HB[m][4] < z.lo : HB[m][4] > z.hi) { z.broke = HB[m][0]; break; }
      if (m >= i + 3 && (bull ? HB[m][3] <= z.hi : HB[m][2] >= z.lo)) z.touches.push(HB[m][0]);
    }
    (bull ? out.D : out.S).push(z);
  }
  return out;
}
// is the sweep at a higher-timeframe point of interest? 2 = a fresh HTF zone, 1 = an HTF swing (liquidity) or a zone tested before, 0 = neither
function smPOI(Z, r, B, htfMs) {
  if (!Z || !Z.atr || !r || !r.swept) return null;
  const bull = r.dir === 'L', tS = B[r.j][0], a = Z.atr, tol = 0.15 * a;
  const zones = (bull ? Z.D : Z.S).filter(z => z.t + htfMs <= tS && !z.broke && (bull ? r.ext <= z.hi + tol && r.ext >= z.lo - 0.6 * a : r.ext >= z.lo - tol && r.ext <= z.hi + 0.6 * a));
  const fresh = zones.find(z => !z.touches.some(t => t < tS - htfMs));
  const z = fresh || zones[zones.length - 1] || null;
  const piv = (bull ? Z.P.L : Z.P.H).filter(p => p.t + htfMs <= tS).find(p => bull ? r.ext < p.px && r.ext > p.px - 1.2 * a : r.ext > p.px && r.ext < p.px + 1.2 * a);
  // a higher-timeframe swing run in discount (long) / premium (short) is a turning point at a key level (daily-swing lesson)
  const pivKey = !!(piv && Z.mid && (bull ? r.ext < Z.mid : r.ext > Z.mid));
  return {ok: fresh || pivKey ? 2 : (z || piv) ? 1 : 0, zone: z ? {lo: z.lo, hi: z.hi, side: z.side, t: z.t, fresh: !!fresh, far: z.far} : null, piv: piv ? piv.px : null, pivKey};
}
// the nearest opposing HTF zone between entry and target (supply above a long, demand below a short)
function smRoom(Z, dir, live, target) {
  if (!Z || !target) return null;
  const bull = dir === 'L', opp = (bull ? Z.S : Z.D).filter(z => !z.broke && (bull ? z.lo > live && z.lo < target : z.hi < live && z.hi > target));
  if (!opp.length) return {clear: true};
  const z = opp.reduce((a, b) => bull ? (b.lo < a.lo ? b : a) : (b.hi > a.hi ? b : a));
  return {clear: false, edge: bull ? z.lo : z.hi, zone: {lo: z.lo, hi: z.hi}};
}
/* ---- draw on liquidity: internal vs external range liquidity on the higher timeframe (MMXM lesson, Nov 9) ----
   External range liquidity = old highs/lows; internal = fair value gaps. Once external liquidity on one side is taken,
   price draws to internal liquidity (an FVG); once an FVG is tagged, it draws to the external liquidity on the other side.
   So: after sell-side was taken or a bullish FVG was tagged, the draw is up; after buy-side was taken or a bearish FVG
   was tagged, the draw is down. Whichever happened last sets the draw. */
function smDraw(HB, hms) {
  if (!HB || HB.length < 12) return null;
  const n = HB.length, P = smPivots(HB, 2); let hiT = -1, loT = -1, fbT = -1, fsT = -1;
  for (const p of P.H) for (let m = p.i + 3; m < n; m++) if (HB[m][2] > p.px) { hiT = Math.max(hiT, m); break; }
  for (const p of P.L) for (let m = p.i + 3; m < n; m++) if (HB[m][3] < p.px) { loT = Math.max(loT, m); break; }
  for (let x = 1; x < n - 2; x++) {
    if (HB[x - 1][2] < HB[x + 1][3]) for (let m = x + 2; m < n; m++) if (HB[m][3] <= HB[x + 1][3]) { fbT = Math.max(fbT, m); break; }
    if (HB[x - 1][3] > HB[x + 1][2]) for (let m = x + 2; m < n; m++) if (HB[m][2] >= HB[x + 1][2]) { fsT = Math.max(fsT, m); break; }
  }
  const upT = Math.max(loT, fbT), dnT = Math.max(hiT, fsT);
  if (upT < 0 && dnT < 0) return {draw: null};
  const up = upT > dnT, t = up ? upT : dnT, ago = Math.round((n - 1 - t) * hms / 3600e3);
  const ev = up ? (upT === loT ? 'sell-side liquidity (an old low) was taken' : 'a bullish FVG was tagged') : (dnT === hiT ? 'buy-side liquidity (an old high) was taken' : 'a bearish FVG was tagged');
  return {draw: up ? 'up' : 'down', ev, ago};
}
// previous UTC day's high and low (the easiest draws on liquidity), from 1h candles; untaken = not yet traded through today
function smPrevDay(s, now_) {
  const H = smBars(s, '1h'); if (!H || H.length < 30) return null;
  const d0 = Math.floor(now_ / 86400e3) * 86400e3, prev = H.filter(b => b[0] >= d0 - 86400e3 && b[0] < d0), today = H.filter(b => b[0] >= d0);
  if (prev.length < 12) return null;
  const pdh = Math.max(...prev.map(b => b[2])), pdl = Math.min(...prev.map(b => b[3]));
  return {pdh, pdl, hTaken: today.some(b => b[2] > pdh), lTaken: today.some(b => b[3] < pdl)};
}
// mitigation block: the entry zone sits inside a failed higher-timeframe zone of the other side
// (a broken supply zone now acting as support for a long, a broken demand zone as resistance for a short)
function smMitigation(Z, r) {
  if (!Z || !r.zone) return null;
  const bull = r.dir === 'L', z = r.zone;
  const m = (bull ? Z.S : Z.D).filter(x => x.broke && z.lo <= x.hi && z.hi >= x.lo);
  return m.length ? {lo: m[m.length - 1].lo, hi: m[m.length - 1].hi} : null;
}
// market cycle (IPDA): a reversal comes after an expansion, or as the manipulation leg of a consolidation (AMD).
// A turn straight out of a quiet range without taking its extreme is the trap the lesson warns about.
function smCycle(B, r) {
  if (!r || r.type === 'cont' || !r.swept || r.j < 10) return null;
  const bull = r.dir === 'L', atr = smATR(B, r.j) || 1e-9, a = Math.max(0, r.j - 16), R = B.slice(a, r.j);
  const hi = Math.max(...R.map(b => b[2])), lo = Math.min(...R.map(b => b[3]));
  const amd = hi - lo <= 4 * atr && Math.abs(r.swept.px - (bull ? lo : hi)) <= 0.35 * atr;
  const W = B.slice(Math.max(0, r.j - 12), r.j + 1), ex = bull ? Math.max(...W.map(b => b[2])) - r.ext : r.ext - Math.min(...W.map(b => b[3]));
  return {amd, exp: ex >= 3 * atr, rangeATR: (hi - lo) / atr, expATR: ex / atr};
}
/* ---- the path to the target: low- vs high-resistance liquidity (from the MMXM failure-swings lesson Fred shared, Nov 9) ----
   On the far side of the trade, swings that failed to beat the previous swing (lower highs above a long, higher lows below
   a short: failure swings) are low-resistance liquidity; price tends to run through them. A swing that ran the previous
   swing and was rejected (wick through, close back) is high-resistance liquidity; price tends to stall there. */
function smPath(B, P, dir, live, target) {
  if (!target) return null;
  const bull = dir === 'L', n = B.length, atr0 = smATR(B, n) || 1e-9;
  // structural swings only: at least 1.5 ATR of price on both sides (the right side may still be forming: 0.75 ATR)
  const prom = p => {
    let la = 0, rb = 0; for (let m = Math.max(0, p.i - 8); m < p.i; m++) la = Math.max(la, bull ? p.px - B[m][3] : B[m][2] - p.px); for (let m = p.i + 1; m <= Math.min(n - 1, p.i + 8); m++) rb = Math.max(rb, bull ? p.px - B[m][3] : B[m][2] - p.px);
    return la >= 1.5 * atr0 && rb >= (p.i > n - 6 ? 0.75 : 1.5) * atr0; };
  const Sw = (bull ? P.H : P.L).filter(prom);
  const untaken = p => { for (let m = p.i + 1; m < n; m++) if (bull ? B[m][2] > p.px : B[m][3] < p.px) return false; return true; };
  const atr = atr0, mid = (Math.max(...B.map(b => b[2])) + Math.min(...B.map(b => b[3]))) / 2; let fs = 0, fsIn = 0; const hr = [];
  Sw.forEach((p, k) => {
    if (!(bull ? p.px > live + 0.25 * atr && p.px < target : p.px < live - 0.25 * atr && p.px > target) || !untaken(p) || !k) return;
    const prev = Sw[k - 1], d = bull ? prev.px - p.px : p.px - prev.px;    // > 0: failed to reach the previous swing
    if (d >= 0.1 * atr) { fs++; if (bull ? p.px < mid : p.px > mid) fsIn++; }   // failure swings still in discount (long) / premium (short): the draw is still ahead
    else if (-d >= 0.05 * atr && (bull ? B[p.i][4] < prev.px : B[p.i][4] > prev.px)) hr.push(p);   // ran it, then closed back: high resistance
  });
  const near = hr.length ? hr.reduce((a, b) => bull ? (b.px < a.px ? b : a) : (b.px > a.px ? b : a)) : null;
  return {fs, fsIn, hr: near ? near.px : null, hrAt: near ? near.i : null};
}
// is the stop behind a high-resistance swing (a low that ran the previous low and closed back above it; mirror for highs)?
function smProtected(B, P, dir, ext, from, to) {
  const bull = dir === 'L'; let xi = from; for (let m = from; m <= to; m++) if (bull ? B[m][3] <= B[xi][3] : B[m][2] >= B[xi][2]) xi = m;
  const prior = (bull ? P.L : P.H).filter(p => p.i < xi && p.i >= xi - 48 && (bull ? p.px > B[xi][3] && B[xi][4] > p.px : p.px < B[xi][2] && B[xi][4] < p.px));
  return prior.length ? prior[prior.length - 1].px : null;
}
// lower-timeframe confirmation for a 1h setup: once price is in the 1h zone, a 15m close beyond the last 15m swing of the pullback
function smConfirm15(s, r) {
  const K = smBars(s, '15m'); if (!K || K.length < 20 || !r.zone) return {ok: false, why: 'no 15m candles'};
  const bull = r.dir === 'L', z = r.zone;
  const t0 = r.touchT || 0; let i0 = K.findIndex(b => b[0] >= t0 && (bull ? b[3] <= z.hi : b[2] >= z.lo));
  if (i0 < 0) return {ok: false, why: 'price has not reached the zone on the 15m'};
  let ex = i0; for (let m = i0; m < K.length; m++) if (bull ? K[m][3] < K[ex][3] : K[m][2] > K[ex][2]) ex = m;
  if (bull ? K[ex][3] < z.lo * 0.998 && K.slice(ex).some(b => b[4] < z.lo) : K[ex][2] > z.hi * 1.002 && K.slice(ex).some(b => b[4] > z.hi)) return {ok: false, why: '15m closed through the zone'};
  const P = smPivots(K, 1), piv = (bull ? P.H : P.L).filter(p => p.i < ex && p.i >= i0 - 8);
  const ref = piv.length ? piv[piv.length - 1].px : (bull ? Math.max(...K.slice(Math.max(0, i0 - 3), i0 + 1).map(b => b[2])) : Math.min(...K.slice(Math.max(0, i0 - 3), i0 + 1).map(b => b[3])));
  const m = K.findIndex((b, j) => j > ex && (bull ? b[4] > ref : b[4] < ref));
  return m > 0 ? {ok: true, ref, at: K[m][0], low: bull ? K[ex][3] : K[ex][2]} : {ok: false, ref, why: `waiting for a 15m close ${bull ? 'above' : 'below'} ${fmtPx(ref)}`};
}
// the best setup across the two entry timeframes (in the zone first, then the higher-quality one)
function smcRead(s) {
  const R = ['15m', '1h'].filter(tf => SM.cfg[tf === '15m' ? 'tf15' : 'tf1h']).map(tf => smcReadTf(s, tf));
  if (!R.length) return {stage: 'none', st: SMST.none, checks: [], score: 0};
  const rank = r => (SMST[r.stage] || SMST.none).code * 1e3 + (r.against || (r.rok && !r.rok.ok) ? -500 : 0) + (r.q ? r.q.score : 0);
  const best = R.slice().sort((a, b) => rank(b) - rank(a))[0];
  best.other = R.find(r => r !== best) || null;
  return best;
}
function smcReadTf(s, tf) {
  const B = smBars(s, tf), tk = SM_OVR && SM_OVR.s === s ? SM_OVR.tk : S.tk.get(s), T = SM_TF[tf];
  if (!B || B.length < T.min || !tk) return {stage: 'wait', st: SMST.wait, checks: [], score: 0, tf};
  const n = B.length, live = tk.last || B[n - 1][4], P = smPivots(B, 2), bias = smBias(s, T.htf);
  const HB = smBars(s, T.htf), hms = T.htf === '4h' ? 4 * 3600e3 : 3600e3, tNow = SM_OVR && SM_OVR.s === s ? SM_OVR.t : now();
  const regime = smRegime(HB && HB.filter(b => b[0] + hms <= tNow));   // closed HTF bars only
  let cands = ['L', 'S'].map(d => smSetup(B, P, d, live)).filter(Boolean);
  if (SM.cfg.cont) for (const d of ['L', 'S']) if (regime.reg === (d === 'L' ? 'up' : 'down')) { const c = smContSetup(B, P, d, live); if (c) cands.push(c); }
  if (SM_OVR && SM_OVR.s === s && SM_OVR.dir) cands = cands.filter(c => c.dir === SM_OVR.dir);   // audit: only the trade's direction
  if (!cands.length) return {stage: 'none', st: SMST.none, checks: [], score: 0, bias, regime, live, tf, htf: T.htf};
  const rank = r => (r.stage === 'inzone' ? 1e6 : r.stage === 'mss' ? 5e5 : r.stage === 'sweep' ? 2e5 : 0) + r.j;
  const r = cands.sort((a, b) => rank(b) - rank(a))[0], bull = r.dir === 'L';
  const Z = smZonesB(HB), rok = smRegimeOk(regime, r.dir, live);
  // 1h setups: price in the 1h zone (first test, or still testing within 4 hours) → wait for a 15m structure shift (lower-timeframe confirmation)
  let conf = null;
  if (tf === '1h' && SM.cfg.ltfConfirm && r.zone && r.touch >= 0 && ['inzone', 'spent'].includes(r.stage) && n - 1 - r.touch <= 6) {
    r.touchT = B[r.touch][0]; conf = smConfirm15(s, r);
    // after the 15m break, enter while price is still at or below the broken 15m level (its retest), not after it has run away
    const zh = r.zone.hi - r.zone.lo, cap = conf.ok ? conf.ref : 0, near = bull ? live >= r.zone.lo && live <= Math.max(r.zone.hi + 0.5 * zh, cap) : live <= r.zone.hi && live >= Math.min(r.zone.lo - 0.5 * zh, cap || Infinity);
    r.stage = conf.ok ? (near ? 'inzone' : 'spent') : (/through/.test(conf.why || '') ? 'invalid' : 'confirm');
  }
  const hi24 = Math.max(...B.map(b => b[2])), lo24 = Math.min(...B.map(b => b[3])), cont = r.type === 'cont';
  const pos = cont ? (live - Math.min(r.ext, r.leg)) / (Math.abs(r.leg - r.ext) || 1) : (live - lo24) / ((hi24 - lo24) || 1);
  const sb = smRules().stopBuf, stopS = bull ? r.ext * (1 - sb / 100) : r.ext * (1 + sb / 100), ms = (SM.cfg.minStopPct || 0) / 100;
  // a stop closer than the minimum sits inside the noise and fees eat the trade: move it out to the minimum distance (the target must still pay)
  const widened = ms > 0 && Math.abs(live - stopS) / live < ms, stop = widened ? live * (bull ? 1 - ms : 1 + ms) : stopS, risk = Math.abs(live - stop);
  // target: the nearest liquidity pool (an untaken swing or the 24h extreme) that pays at least minRR
  // continuation: the buy-side (sell-side) liquidity above (below) the impulse high (low), then a measured move of the impulse from the entry
  const PD = SM.cfg.pdLiq ? smPrevDay(s, SM_OVR && SM_OVR.s === s ? SM_OVR.t : now()) : null;
  const extra = [...(cont ? [r.leg, live + (bull ? 1 : -1) * Math.abs(r.leg - r.ext)] : []), ...(PD ? [bull ? (!PD.hTaken ? PD.pdh : null) : (!PD.lTaken ? PD.pdl : null)].filter(fin) : [])];
  const pools = bull ? [...P.H.filter(p => p.px > live).map(p => p.px), hi24, ...extra].filter(px => px > live).sort((a, b) => a - b) : [...P.L.filter(p => p.px < live).map(p => p.px), lo24, ...extra].filter(px => px < live).sort((a, b) => b - a);
  let target = null, rr = null;
  for (const px of pools) { const q = Math.abs(px - live) / (risk || 1); if (q >= SM.cfg.minRR) { target = q > SM.cfg.maxRR ? live + (bull ? 1 : -1) * SM.cfg.maxRR * risk : px; rr = Math.min(q, SM.cfg.maxRR); break; } }
  // room: an opposing higher-timeframe zone before the target caps it at the zone's near edge; if that leaves less than minRR, there's no room
  let room = SM.cfg.roomCheck ? smRoom(Z, r.dir, live, target) : null;
  if (room && !room.clear) { const q = Math.abs(room.edge - live) / (risk || 1); room.rr = q; if (q >= SM.cfg.minRR) { target = room.edge; rr = Math.min(q, SM.cfg.maxRR); room.capped = true; } else room.blocked = true; }
  // path: cap the target before a high-resistance swing in the way (if that still pays minRR); otherwise there's no clean path
  let path = SM.cfg.pathCheck ? smPath(B, P, r.dir, live, target) : null;
  if (path && path.hr) { const edge = path.hr, q = Math.abs(edge - live) / (risk || 1); path.rr = q; if (q >= SM.cfg.minRR) { target = edge; rr = Math.min(q, SM.cfg.maxRR); path.capped = true; } else path.blocked = true; }
  const prot = cont ? smProtected(B, P, r.dir, r.ext, r.j, r.k) : null;
  const draw = smDraw(HB, hms), mit = smMitigation(Z, r), cyc = smCycle(B, r);
  const pdSwept = !!(PD && r.swept && (bull ? r.ext < PD.pdl && B[r.j][4] > PD.pdl : r.ext > PD.pdh && B[r.j][4] < PD.pdh));
  const pdTarget = !!(PD && fin(target) && (bull ? !PD.hTaken && target >= PD.pdh * 0.999 : !PD.lTaken && target <= PD.pdl * 1.001));
  const poi = smPOI(Z, r, B, hms);
  const vBefore = B.slice(Math.max(0, r.j - 24), r.j).reduce((a, b) => a + b[5], 0) / Math.max(1, Math.min(24, r.j));
  const vLeg = Math.max(...B.slice(r.j, (r.k > 0 ? r.k : n - 1) + 1).map(b => b[5]));
  const P_ = (ok, label, d) => ({ok, label, d});
  const checks = cont ? [
    P_(true, `${T.htf} structure ${bull ? 'rising' : 'falling'} (continuation only with the higher timeframe)`, `${T.htf} ${bias}`),
    P_(true, `${tf} already trending ${bull ? 'up' : 'down'} before the break (${bull ? 'rally-base-rally' : 'drop-base-drop'})`, ''),
    P_(r.k > 0, bull ? 'Break of structure up (close above the last swing high)' : 'Break of structure down (close below the last swing low)', `broke ${fmtPx(r.lvl.px)} at ${hhmm(B[r.k][0])}`),
    P_(true, 'Impulsive departure from the base (1.5+ ATR)', `${fmtPx(r.ext)} → ${fmtPx(r.leg)}`),
    P_(r.zone ? r.zone.kind === 'FVG' : null, 'Fair value gap left by the move (else the base candle)', r.zone ? `${r.zone.kind} ${fmtPx(r.zone.lo)}–${fmtPx(r.zone.hi)}` : '—'),
    P_(vBefore > 0 ? vLeg >= 1.5 * vBefore : null, 'Departure on volume (≥ 1.5× average)', vBefore > 0 ? (vLeg / vBefore).toFixed(1) + '×' : '—'),
  ] : [
    P_(true, bull ? 'Sell-side liquidity swept (stop hunt below a swing low)' : 'Buy-side liquidity swept (stop hunt above a swing high)', `swing ${fmtPx(r.swept.px)} taken at ${hhmm(B[r.j][0])}, extreme ${fmtPx(r.ext)}`),
    P_(r.k > 0, bull ? 'Market structure shift up (close above the last swing high)' : 'Market structure shift down (close below the last swing low)', r.k > 0 ? `broke ${fmtPx(r.lvl.px)} at ${hhmm(B[r.k][0])}` : `needs a close beyond ${fmtPx(r.lvl.px)}`),
    P_(r.zone ? r.zone.kind === 'FVG' : null, 'Fair value gap left by the displacement (else order block)', r.zone ? `${r.zone.kind} ${fmtPx(r.zone.lo)}–${fmtPx(r.zone.hi)}` : '—'),
    P_(bull ? pos <= 0.5 : pos >= 0.5, bull ? 'Entry in discount (lower half of the 24h range)' : 'Entry in premium (upper half of the 24h range)', `${Math.round(pos * 100)}% of the 24h range`),
    P_(rok.ok, `${T.htf} regime fits a ${bull ? 'long' : 'short'} (higher timeframe agrees)`, `${T.htf} ${regime.reg || 'unclear'}: ${rok.why}`),
    P_(vBefore > 0 ? vLeg >= 1.5 * vBefore : null, 'Displacement on volume (≥ 1.5× average)', vBefore > 0 ? (vLeg / vBefore).toFixed(1) + '×' : '—'),
  ];
  const score = checks.filter(c => c.ok === true).length;
  const against = !!bias && (bull ? bias === 'bear' : bias === 'bull');
  return {stage: r.stage, st: SMST[r.stage], dir: r.dir, setup: r, zone: r.zone, stop, target, rr, score, checks, bias, live, pos, risk, dist: risk / live, widened,
    tf, htf: T.htf, against, regime, rok, poi, room, conf, path, draw, mit, cyc, PD, pdSwept, pdTarget, q: smQuality(B, r, live, tf, bias, pos, {poi, room, htf: T.htf, conf, path, prot, cont, draw, mit, cyc, pdSwept, pdTarget, PD, regime, rok})};
}
/* ---- setup quality in SMC terms (0–100, A–F) ---- */
function smATR(B, end, n = 14) { let a = 0, c = 0; for (let i = Math.max(1, end - n); i < end; i++) { a += Math.max(B[i][2] - B[i][3], Math.abs(B[i][2] - B[i - 1][4]), Math.abs(B[i][3] - B[i - 1][4])); c++; } return c ? a / c : null; }
// each item: k (factor), ok 2 good / 1 fair / 0 poor, t (plain words)
function smQuality(B, r, live, tf, bias, pos, X = {}) {
  if (!r || !r.zone || !(r.k > 0)) return null;
  const bull = r.dir === 'L', atr = smATR(B, r.j) || (B[r.j][2] - B[r.j][3]) || 1e-9, I = [], add = (k, ok, t, bonus) => I.push(bonus ? {k, ok, t, bonus: 1} : {k, ok, t});
  const P = smPivots(B, 2), cont = r.type === 'cont';
  if (cont) add('trend', 2, `Continuation with the trend: ${SM_TF[tf].htf} and ${tf} both ${bull ? 'rising' : 'falling'} (${bull ? 'rally-base-rally' : 'drop-base-drop'})`);
  else {
  const sw = Math.abs(r.ext - r.swept.px) / atr;
  add('sweep', sw >= 0.15 && sw <= 2.5 ? 2 : sw < 0.15 ? 1 : 0, sw < 0.15 ? `Sweep barely took the level (${sw.toFixed(2)} ATR)` : sw > 2.5 ? `Sweep ran ${sw.toFixed(1)} ATR past the level: more a breakdown than a stop hunt` : `Clean sweep, ${sw.toFixed(2)} ATR through the level, closed back inside`);
  const eq = (bull ? P.L : P.H).filter(p => p.i < r.j && p.i >= r.j - 48 && Math.abs(p.px - r.swept.px) <= 0.25 * atr).length;
  add('liq', eq >= 2 ? 2 : 1, eq >= 2 ? `Swept equal ${bull ? 'lows' : 'highs'} (${eq} touches): real resting liquidity` : `Swept a single swing ${bull ? 'low' : 'high'}, not equal ${bull ? 'lows' : 'highs'}`);
  }
  if (!cont) {
    // candle confirmation (swing formation): the sweep candle (C2) closed back inside in the trade's direction, or the next candle (C3) closed beyond it
    const c2 = B[r.j], c3 = B[r.j + 1], c2ok = bull ? c2[4] > c2[1] : c2[4] < c2[1], c3ok = c3 && (bull ? c3[4] > c2[2] : c3[4] < c2[3]);
    add('c2', c2ok || c3ok ? 2 : 1, c2ok ? `Sweep candle closed ${bull ? 'bullish' : 'bearish'} back inside: the swing is confirmed on its own candle` : c3ok ? `Two-stage confirmation: the candle after the sweep closed ${bull ? 'above' : 'below'} the sweep candle` : `Sweep candle closed back inside but stayed ${bull ? 'bearish' : 'bullish'}, and the next candle didn't confirm`, true);
    // intra-candle reversal: the higher-timeframe candle first traded against the trade beyond its open (the manipulation leg), then turned
    const hm = tf === '15m' ? 3600e3 : 4 * 3600e3, st = Math.floor(B[r.j][0] / hm) * hm; let oi = r.j; while (oi > 0 && B[oi - 1][0] >= st) oi--;
    const op = B[oi][1], man = bull ? r.ext < op : r.ext > op;
    add('open', man ? 2 : 1, man ? `The sweep traded ${bull ? 'below' : 'above'} the ${SM_TF[tf].htf} candle's open (${fmtPx(op)}): the manipulation leg of that candle is done` : `The sweep stayed ${bull ? 'above' : 'below'} the ${SM_TF[tf].htf} candle's open: no manipulation leg against the trade yet`, true);
  }
  // the departure from the zone (supply & demand strength: how impulsive the move away was)
  { let xi = r.j; for (let m = r.j; m <= r.k; m++) if (bull ? B[m][3] <= B[xi][3] : B[m][2] >= B[xi][2]) xi = m;
    let hi = xi; for (let m = xi; m <= Math.min(r.k + 2, B.length - 1); m++) if (bull ? B[m][2] >= B[hi][2] : B[m][3] <= B[hi][3]) hi = m;
    const dep = Math.abs((bull ? B[hi][2] : B[hi][3]) - r.ext) / atr, nb = hi - xi + 1;
    const big = B.slice(xi, hi + 1).filter(b => (bull ? b[4] > b[1] : b[4] < b[1]) && Math.abs(b[4] - b[1]) >= 0.6 * (b[2] - b[3]) && b[2] - b[3] >= atr).length;
    add('dep', (dep >= 2.5 && nb <= 6) || big >= 2 ? 2 : dep >= 1.5 ? 1 : 0, `${(dep >= 2.5 && nb <= 6) || big >= 2 ? 'Impulsive' : dep >= 1.5 ? 'Moderate' : 'Weak'} departure: ${dep.toFixed(1)} ATR in ${nb} candle${nb > 1 ? 's' : ''}${big ? `, ${big} large-bodied` : ''}`); }
  const kb = B[r.k], body = Math.abs(kb[4] - kb[1]) / Math.max(1e-12, kb[2] - kb[3]), past = Math.abs(kb[4] - r.lvl.px) / atr;
  add('mss', body >= 0.6 && past >= 0.1 ? 2 : body >= 0.4 ? 1 : 0, body >= 0.6 && past >= 0.1 ? `Decisive structure break: ${Math.round(body * 100)}% body, closed ${past.toFixed(2)} ATR beyond` : `Weak structure break: ${Math.round(body * 100)}% body, ${past.toFixed(2)} ATR beyond the level`);
  const z = r.zone, zs = (z.hi - z.lo) / atr, vb = B.slice(Math.max(0, r.j - 24), r.j), vAvg = vb.length ? vb.reduce((a, b) => a + b[5], 0) / vb.length : 0;
  if (z.kind === 'FVG') {
    const d = B[z.i], db = Math.abs(d[4] - d[1]) / Math.max(1e-12, d[2] - d[3]), dv = vAvg ? d[5] / vAvg : null;
    add('gap', zs >= 0.3 && zs <= 3 ? 2 : zs >= 0.15 ? 1 : 0, zs < 0.15 ? `Tiny gap (${zs.toFixed(2)} ATR): little imbalance to react from` : zs > 3 ? `Very wide gap (${zs.toFixed(1)} ATR): entry far from the invalidation` : zs < 0.3 ? `Small gap (${zs.toFixed(2)} ATR)` : `Healthy gap: ${zs.toFixed(2)} ATR`);
    add('disp', db >= 0.6 && (dv == null || dv >= 1.5) ? 2 : db >= 0.45 ? 1 : 0, `Gap candle: body ${Math.round(db * 100)}% of its range${dv ? `, ${dv.toFixed(1)}× average volume` : ''}${db >= 0.6 && (dv == null || dv >= 1.5) ? ' (real displacement)' : ' (weak displacement)'}`);
  } else {
    let imb = false; for (let i = z.i + 1; i <= Math.min(z.i + 3, B.length - 2); i++) if (bull ? B[i - 1][2] < B[i + 1][3] : B[i - 1][3] > B[i + 1][2]) imb = true;
    const took = bull ? z.lo <= r.ext * 1.001 : z.hi >= r.ext * 0.999;
    add('ob', zs <= 1.5 && imb ? 2 : zs <= 2.5 ? 1 : 0, `${cont ? (imb ? 'Base candle with an imbalance right after it' : 'Base candle without a gap after it') : (imb ? 'Order block with an imbalance right after it' : 'Order block without a gap after it')}, ${zs.toFixed(2)} ATR tall`);
    if (!cont) add('obliq', took ? 2 : 1, took ? 'The order block itself took the liquidity' : 'The order block sits away from the sweep');
  }
  add('pd', bull ? (pos <= 0.35 ? 2 : pos <= 0.5 ? 1 : 0) : (pos >= 0.65 ? 2 : pos >= 0.5 ? 1 : 0), `${bull ? 'Discount' : 'Premium'} location: ${Math.round(pos * 100)}% of the ${cont ? 'impulse leg' : 'range'}${(bull ? pos > 0.5 : pos < 0.5) ? ` (in ${bull ? 'premium' : 'discount'}: wrong side)` : ''}`);
  const htf = SM_TF[tf].htf, al = bias ? (bull ? bias === 'bull' : bias === 'bear') : null;
  if (X.poi) add('poi', X.poi.ok, X.poi.ok === 2 && !X.poi.zone ? `Sweep ran a ${htf} swing ${bull ? 'low in discount' : 'high in premium'} (${fmtPx(X.poi.piv)}): a turning point at a key level` : X.poi.ok === 2 ? `Sweep into a fresh ${htf} ${bull ? 'demand' : 'supply'} zone (${fmtPx(X.poi.zone.lo)}–${fmtPx(X.poi.zone.hi)}): reversal from a higher-timeframe point of interest` : X.poi.ok === 1 ? (X.poi.zone ? `Sweep into a ${htf} ${bull ? 'demand' : 'supply'} zone that was already tested` : `Sweep took a ${htf} swing ${bull ? 'low' : 'high'} (${fmtPx(X.poi.piv)}): higher-timeframe liquidity`) : `No ${htf} zone or swing at the sweep: a reversal in the middle of the ${htf} range`);
  if (X.room) add('room', X.room.clear ? 2 : X.room.capped ? 1 : 0, X.room.clear ? `No opposing ${htf} ${bull ? 'supply' : 'demand'} before the target` : X.room.capped ? `Target moved to the ${htf} ${bull ? 'supply' : 'demand'} at ${fmtPx(X.room.edge)} (${X.room.rr.toFixed(1)}R)` : `${htf} ${bull ? 'supply' : 'demand'} at ${fmtPx(X.room.edge)} is only ${X.room.rr.toFixed(1)}R away: no room`);
  if (X.path) add('path', X.path.capped ? 1 : X.path.fs >= 2 || X.path.fsIn >= 1 ? 2 : 1, X.path.capped ? `Target moved in front of a high-resistance ${bull ? 'high' : 'low'} at ${fmtPx(X.path.hr)} (it ran a previous swing and was rejected) — ${X.path.rr.toFixed(1)}R` : X.path.fs >= 2 || X.path.fsIn >= 1 ? `Low-resistance path: ${X.path.fs} failure swing${X.path.fs > 1 ? 's' : ''} (${bull ? 'lower highs' : 'higher lows'}) between entry and target${X.path.fsIn ? `, ${X.path.fsIn} still in ${bull ? 'discount' : 'premium'}` : ''}` : X.path.fs === 1 ? `One failure swing on the way to the target` : `No failure swings on the way to the target`);
  if (X.cont) add('prot', X.prot ? 2 : 1, X.prot ? `Stop behind a high-resistance ${bull ? 'low' : 'high'}: the base ran the ${bull ? 'low' : 'high'} at ${fmtPx(X.prot)} and was rejected` : `Base ${bull ? 'low' : 'high'} didn't run a previous swing`);
  // (not scored on continuation setups: in a trend the higher timeframe keeps taking the old highs/lows in the trend's direction,
  //  which this read would call a draw the other way)
  if (X.draw && X.draw.draw && !cont) { const w = X.draw.draw === (bull ? 'up' : 'down'); add('draw', w ? 2 : 0, `${w ? 'With' : 'Against'} the ${htf} draw on liquidity: ${X.draw.ev} ${X.draw.ago < 1 ? 'within the hour' : X.draw.ago + 'h ago'}, so price is drawing ${X.draw.draw === 'up' ? 'up to buy-side (old highs)' : 'down to sell-side (old lows)'}`); }
  if (X.PD) add('pday', X.pdSwept || X.pdTarget ? 2 : 1, X.pdSwept ? `Swept the previous day's ${bull ? 'low' : 'high'} (${fmtPx(bull ? X.PD.pdl : X.PD.pdh)}): the easiest liquidity pool` : X.pdTarget ? `Target is the previous day's ${bull ? 'high' : 'low'} (${fmtPx(bull ? X.PD.pdh : X.PD.pdl)}), still untaken today` : `Previous day ${bull ? 'high' : 'low'} ${(bull ? X.PD.hTaken : X.PD.lTaken) ? 'already taken today' : 'not on this trade\'s path'}`, true);
  if (X.mit) add('mit', 2, `Entry zone inside a mitigation block: a failed ${htf} ${bull ? 'supply' : 'demand'} zone (${fmtPx(X.mit.lo)}–${fmtPx(X.mit.hi)}) where positions get mitigated`, true);
  if (X.cyc) add('cycle', X.cyc.amd || X.cyc.exp ? 2 : 1, X.cyc.amd ? `Market cycle: accumulation → manipulation (swept the ${bull ? 'low' : 'high'} of a ${X.cyc.rangeATR.toFixed(1)}-ATR range) → distribution` : X.cyc.exp ? `Market cycle: expansion (${X.cyc.expATR.toFixed(1)} ATR) → reversal` : `Market cycle unclear: no expansion into the sweep and no tight range swept (a turn out of consolidation is often a trap)`);
  if (r.zone && r.zone.bg) add('bg', 1, `Breakaway move: the impulse left stacked gaps; the newest gap may only be tested at its edge`, true);
  if (X.conf && X.conf.ok) add('conf', 2, `15m confirmed: closed ${bull ? 'above' : 'below'} ${fmtPx(X.conf.ref)} inside the 1h zone`);
  if (X.rok) add('htf', X.rok.ok ? 2 : 0, `${htf} ${X.regime.reg || 'regime unclear'}: ${X.rok.why}`);
  else add('htf', al === true ? 2 : al === null ? 1 : 0, al === true ? `${htf} structure agrees (${bias === 'bull' ? 'rising' : 'falling'})` : al === null ? `${htf} structure unclear` : `${htf} structure is ${bias === 'bull' ? 'rising' : 'falling'}: against the trade`);
  const dz = bull ? (z.hi - live) / Math.max(1e-12, z.hi - z.lo) : (live - z.lo) / Math.max(1e-12, z.hi - z.lo);
  add('depth', dz >= 0.5 ? 2 : dz >= 0.1 ? 1 : 0, dz >= 0.5 ? `Entered at or past the zone's midpoint (${Math.round(Math.min(1, dz) * 100)}% in)` : `Entered at the edge of the zone (${Math.round(Math.max(0, dz) * 100)}% in)`);
  // bonus items (previous-day liquidity, mitigation block, breakaway note) only count when they're present and good
  const C = I.filter(x => !(x.bonus && x.ok < 2)), score = Math.round(C.reduce((a, x) => a + x.ok, 0) / (C.length * 2) * 100);
  return {score, grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F', worst: (I.find(x => x.ok === 0) || {}).t || '', atr, zs, dz, items: I, tf, bias};
}

/* ---- account ---- */
function smUpnl(p, px) { return (p.side === 'L' ? 1 : -1) * (px - p.entry) * p.qty; }
function smEquity() { let e = SM.cash; for (const s in SM.pos) { const px = ptPx(s); if (px) e += smUpnl(SM.pos[s], px); } return e; }
function smExposure() { let n = 0; for (const s in SM.pos) n += SM.pos[s].qty * (ptPx(s) || SM.pos[s].entry); return n; }
function smFill(px, side, opening) { const sl = SM.cfg.slipPct / 100, buy = (side === 'L') === opening; return px * (buy ? 1 + sl : 1 - sl); }
function smR(p, px) { const d = Math.abs(p.entry - p.stop0); return d ? (p.side === 'L' ? px - p.entry : p.entry - px) / d : 0; }
function smClose(s, frac, why) {
  const p = SM.pos[s], px = ptPx(s); if (!p || !px) return;
  const q = frac >= 1 ? p.qty : p.qty * frac, fill = smFill(px, p.side, false);
  const pnl = (p.side === 'L' ? 1 : -1) * (fill - p.entry) * q, fee = q * fill * SM.cfg.feePct / 100;
  SM.cash += pnl - fee; p.realized += pnl - fee; p.fees += fee; p.qty -= q; p.exits.push({t: now(), px: fill, q, why});
  if (frac >= 1 || p.qty <= p.qty0 * 1e-6) {
    const R = p.risk ? p.realized / p.risk : 0;
    SM.log.unshift({s, b: p.b, side: p.side, t0: p.t, t1: now(), entry: p.entry, exit: fill, qty: p.qty0, notional: p.qty0 * p.entry, pnl: p.realized, R, fees: p.fees,
      funding: p.funding || 0, why: p.why, exitWhy: why, stop0: p.stop0, maxR: p.maxR || 0, sc: p.sc, rr: p.rr, zoneKind: p.zoneKind, target: p.target, zone: p.zone ? {lo: p.zone.lo, hi: p.zone.hi, kind: p.zone.kind} : null, sweep: p.sweep, lvl: p.lvl, unlK: p.unlK || 'none', ceBroke: p.ceBroke || 0, strat: 'smc', tf: p.tf || '15m', htfBias: p.htfBias || null, q: p.q || null, poi: p.poi || null, type: p.type || 'rev', regime: p.regime || null, play: p.play || null, zc: p.zc || null, holdH: p.holdH, cx: p.cx, scr: p.scr || null, ex: (p.exits || []).map(e => [e.t, e.px, e.why])});
    if (SM.log.length > 500) SM.log.pop();
    delete SM.pos[s]; SM.cool[s] = now();
    raise('smc', s, 'close' + now(), `SMC PAPER ${p.side === 'L' ? 'long' : 'short'} ${p.b} closed ${fmtMoney(p.realized, 1)} (${R >= 0 ? '+' : ''}${R.toFixed(2)}R) — ${why}`, p.realized >= 0 ? 1 : -1, 0, true);
  } else raise('smc', s, 'part' + now(), `SMC PAPER ${p.b}: ${why} (${fmtMoney(pnl - fee, 1)} banked)`, 1, 0);
}
function smTryEnter(c) {
  const {s, r, tk} = c, side = r.dir, px = tk.last;
  const fill = smFill(px, side, true), stop = r.stop;
  if (side === 'L' ? stop >= fill : stop <= fill) { c.skip = 'price already beyond the stop'; return false; }
  const dist = Math.abs(fill - stop) / fill;
  const eq = smEquity(), riskUsd = eq * SM.cfg.riskPct * smRules().riskMul / 100;
  let qty = riskUsd / Math.abs(fill - stop);
  const perPosCap = eq * SM.cfg.maxLev / SM.cfg.maxPos, roomLeft = eq * SM.cfg.maxLev - smExposure();
  qty = Math.min(qty, perPosCap / fill, Math.max(0, roomLeft) / fill);
  if (qty * fill < 10) { c.skip = 'not enough room under the leverage cap'; return false; }
  const fee = qty * fill * SM.cfg.feePct / 100; SM.cash -= fee;
  const rr = Math.abs(r.target - fill) / Math.abs(fill - stop), uc = unlCtx(s);
  const why = `${r.dir === 'L' ? 'Bullish' : 'Bearish'} SMC ${r.tf || '15m'} ${r.setup.type === 'cont' ? (r.dir === 'L' ? 'continuation (rally-base-rally) ' : 'continuation (drop-base-drop) ') : ''}${r.score}/6, quality ${r.q ? r.q.grade : '?'} — ${r.setup.type === 'cont' ? `${r.htf} and ${r.tf} trending, base at ${fmtPx(r.setup.ext)}, broke ${fmtPx(r.setup.lvl.px)}` : `swept ${fmtPx(r.setup.swept.px)}, shift through ${fmtPx(r.setup.lvl.px)}`}${r.regime && r.rok ? `, ${r.htf} ${r.regime.reg} (${r.rok.play} play)` : ''}, ${r.zone.kind} ${fmtPx(r.zone.lo)}–${fmtPx(r.zone.hi)}, target ${fmtPx(r.target)} (${rr.toFixed(1)}R)${r.poi && r.poi.ok === 2 ? `, from a fresh ${r.htf} ${r.dir === 'L' ? 'demand' : 'supply'} zone` : r.poi && r.poi.ok === 1 ? `, at ${r.htf} ${r.poi.zone ? 'zone' : 'liquidity'}` : ''}${r.conf && r.conf.ok ? ', 15m confirmed' : ''}${r.room && r.room.capped ? `, target capped at ${r.htf} ${r.dir === 'L' ? 'supply' : 'demand'}` : ''}${r.path && r.path.capped ? `, target in front of a high-resistance ${r.dir === 'L' ? 'high' : 'low'}` : r.path && r.path.fs >= 2 ? `, low-resistance path (${r.path.fs} failure swings)` : ''}`;
  SM.pos[s] = {cx: entryCtx(s, r.checks), scr: typeof scrRec === 'function' ? scrRec(c) : null, side, b: base(s), qty, qty0: qty, entry: fill, stop, stop0: stop, target: r.target, rr, t: now(), risk: qty * Math.abs(fill - stop), realized: -fee, fees: fee, funding: 0,
    why, sc: r.score, zoneKind: r.zone.kind, zone: r.zone, sweep: r.setup.ext, lvl: r.setup.lvl.px, unlK: uc.phase && uc.big ? uc.phase : 'none', nf: null, be: false, tp1: false, maxR: 0, exits: [], dist: dist * 100,
    tf: r.tf || '15m', htfBias: r.bias || null, holdH: (r.tf === '1h' ? SM.cfg.holdH1h : SM.cfg.holdH), q: r.q ? {score: r.q.score, grade: r.q.grade, items: r.q.items, zs: r.q.zs, dz: r.q.dz} : null, tp1R: smRules().tp1R, poi: r.poi && r.poi.zone ? r.poi.zone : null, type: r.setup.type || 'rev', wid: r.widened ? 1 : 0, regime: r.regime ? r.regime.reg : null, play: r.rok ? r.rok.play : null, zc: r.setup.zc || null};
  raise('smc', s, 'open' + now(), `SMC PAPER ${side === 'L' ? 'LONG' : 'SHORT'} ${base(s)} @ ${fmtPx(fill)} · stop ${fmtPx(stop)} (${(dist * 100).toFixed(1)}%) · target ${fmtPx(r.target)} (${rr.toFixed(1)}R) · ${r.tf || '15m'} ${r.zone.kind} entry, ${r.score}/6, quality ${r.q ? r.q.grade : '?'}`, side === 'L' ? 1 : -1, 0, true);
  smSave(); return true;
}
// manage positions; with `only` the cloud bot replays one coin's candles (stop / partial / target / time checks only)
function smManage(t, only) {
  for (const s of only ? [only] : Object.keys(SM.pos)) {
    const p = SM.pos[s]; if (!p) continue; const px = ptPx(s); if (!px) continue;
    const L = p.side === 'L';
    const f = only ? null : S.fund.get(s);
    if (f && fin(f.r)) {
      if (!p.nf) p.nf = f.next;
      else if (f.next && f.next > p.nf && t >= p.nf) { const amt = -(L ? 1 : -1) * f.r * p.qty * px; SM.cash += amt; p.realized += amt; p.funding = (p.funding || 0) + amt; p.nf = f.next; }
    }
    if (L ? px <= p.stop : px >= p.stop) { smClose(s, 1, p.be ? (p.trail ? 'trailing stop (under the last swing)' : 'stopped at breakeven') : 'stop loss hit (beyond the sweep)'); continue; }
    const r = smR(p, px); p.maxR = Math.max(p.maxR || 0, r);
    const t1R = p.tp1R || SM.cfg.tp1R;
    if (!p.tp1 && r >= t1R) { p.tp1 = true; smClose(s, 0.5, `took half at +${t1R}R`); p.stop = p.entry; p.be = true; if (!SM.pos[s]) continue; }
    if (L ? px >= p.target : px <= p.target) { smClose(s, 1, `target reached (liquidity at ${fmtPx(p.target)})`); continue; }
    const hold = p.holdH || SM.cfg.holdH;
    if (t - p.t > hold * 3600e3) { smClose(s, 1, `time stop (${hold}h)`); continue; }
    if (only) continue;
    if (!p.be && p.zone && fin(p.zone.lo)) {
      const TB = smBars(s, p.tf || '15m');
      if (TB && TB.length > 2) {
        const ce = (p.zone.lo + p.zone.hi) / 2;
        for (let i = TB.length - 2; i >= 0 && TB[i][0] >= p.t; i--) if (L ? TB[i][4] < ce : TB[i][4] > ce) p.ceBroke = 1; // closed candles since the entry
        const lc = TB[TB.length - 2];
        if (SM.cfg.invExit && lc && lc[0] >= p.t && (L ? lc[4] < p.zone.lo : lc[4] > p.zone.hi)) { smClose(s, 1, `the ${p.zoneKind || 'zone'} failed: a ${p.tf || '15m'} candle closed ${L ? 'below' : 'above'} it (invalidation)`); continue; }
      }
    }
    if (L && SM.cfg.unlGuard) { const u = unlCtx(s, t); if (u.phase === 'ahead' && u.big && u.hours <= 12) { smClose(s, 1, `closed ahead of the ${u.e.b} token unlock (${unlWhen(u)})`); continue; } }
    // after the partial: trail behind each new confirmed swing on the trade's own timeframe (structure-based trailing)
    if (p.be) {
      const TB = smBars(s, p.tf || '15m');
      if (TB && TB.length > 10) {
        const P = smPivots(TB, 2), sw = (L ? P.L : P.H).filter(q => q.t > p.t && q.i + 2 < TB.length).pop();
        if (sw) { const ns = L ? sw.px * (1 - SM.cfg.stopBuf / 100) : sw.px * (1 + SM.cfg.stopBuf / 100); if (L ? ns > p.stop : ns < p.stop) { p.stop = ns; p.trail = true; } }
      }
    }
  }
}
function smTick() {
  if (!S.tk.size || !warm || syViewer()) return;
  const t = now(), today = new Date(t).toDateString();
  if (!SM.day || SM.day.d !== today) { SM.day = {d: today, eq0: smEquity()}; SM.paused = null; }
  smManage(t);
  const eq = smEquity();
  if (!SM.paused && eq < SM.day.eq0 * (1 - SM.cfg.dailyLossPct / 100)) { SM.paused = 'daily loss limit'; raise('smc', 'ACCOUNT', 'pause', `SMC Trader: daily loss limit hit (${fmtMoney(eq - SM.day.eq0, 1)}). No new trades until tomorrow.`, -1, 0, true); }
  const cands = [];
  for (const s of Object.keys(S.trk)) {
    const r = smcRead(s); S.smC.set(s, r);
    if (r.stage !== 'inzone') continue;
    const tk = S.tk.get(s), c = {s, r, tk, b: base(s), side: r.dir};
    const u = unlCtx(s), fk = !!(r.rok && r.rok.play === 'fakeout');   // a fakeout trades against the last break by definition: skip the bias checks
    if (SM.pos[s]) c.skip = 'already in a position';
    else if (SM.cool[s] && t - SM.cool[s] < 2 * 3600e3) c.skip = 'cooling down after a recent trade';
    else if (!r.rok || !r.rok.ok) c.skip = `${r.htf} regime ${(r.regime && r.regime.reg) || 'unclear'}: ${r.rok ? r.rok.why : 'regime unclear'}`;
    else if (r.against && !fk) c.skip = `${r.htf} structure is ${r.bias === 'bear' ? 'falling' : 'rising'}: no ${r.dir === 'L' ? 'longs' : 'shorts'} on the ${r.tf} against it`;
    else if (smRules().needHTF && !fk && !(r.bias && (r.dir === 'L' ? r.bias === 'bull' : r.bias === 'bear'))) c.skip = `${r.htf} structure must agree (Reviewer's SMC rule); it's ${r.bias ? (r.bias === 'bull' ? 'rising' : 'falling') : 'unclear'}`;
    else if (smRules().needDraw && !(r.setup && r.setup.type === 'cont') && r.draw && r.draw.draw && r.draw.draw !== (r.dir === 'L' ? 'up' : 'down')) c.skip = `against the ${r.htf} draw on liquidity (${r.draw.ev}; Reviewer's SMC rule)`;
    else if (r.setup && r.setup.type === 'cont' && smRules().noCont) c.skip = 'continuation setups paused (Reviewer\'s SMC rule)';
    else if (r.poi && r.poi.ok === 0 && (smRules().needPOI || (SM.cfg.poiRule && !fk && !(r.bias && (r.dir === 'L' ? r.bias === 'bull' : r.bias === 'bear'))))) c.skip = `${r.htf} isn't trending ${r.dir === 'L' ? 'up' : 'down'} and the sweep isn't at a ${r.htf} ${r.dir === 'L' ? 'demand zone or swing low' : 'supply zone or swing high'}${smRules().needPOI ? ' (Reviewer\'s SMC rule)' : ''}`;
    else if (r.path && r.path.blocked) c.skip = `high-resistance ${r.dir === 'L' ? 'high' : 'low'} at ${fmtPx(r.path.hr)} is only ${r.path.rr.toFixed(1)}R away: price tends to stall there`;
    else if (r.room && r.room.blocked) c.skip = `${r.htf} ${r.dir === 'L' ? 'supply' : 'demand'} at ${fmtPx(r.room.edge)} is only ${r.room.rr.toFixed(1)}R away (needs ${SM.cfg.minRR}R of room)`;
    else if (r.score < SM.cfg.minScore) c.skip = `only ${r.score}/6 confluences (needs ${SM.cfg.minScore})`;
    else if (r.q && r.q.score < smRules().minQ) c.skip = `setup quality ${r.q.grade} (${r.q.score}/100, needs ${smRules().minQ})${r.q.worst ? ': ' + r.q.worst.toLowerCase() : ''}`;
    else if (smRules().fvgOnly && r.zone.kind !== 'FVG') c.skip = 'order block entry: FVG only (Reviewer\'s SMC rule)';
    else if (smRules().noTf && smRules().noTf === r.tf) c.skip = `${r.tf} setups paused (Reviewer's SMC rule)`;
    else if (smRules().needDepth && r.q && r.q.dz < 0.5 && !(r.setup && r.setup.zone && r.setup.zone.bg)) c.skip = `waiting for a deeper entry: ${Math.round(Math.max(0, r.q.dz) * 100)}% into the zone, needs 50% (Reviewer's SMC rule)`;
    else if (SM.cfg.minDepth && r.q && r.q.dz < SM.cfg.minDepth / 100 && !(r.setup && r.setup.zone && r.setup.zone.bg) && !(r.conf && r.conf.ok)) c.skip = `at the edge of the zone (${Math.round(Math.max(0, r.q.dz) * 100)}% in): waiting for ${SM.cfg.minDepth}% into it`;
    else if (!r.target) c.skip = `no liquidity target ≥ ${SM.cfg.minRR}R away`;
    else if (r.dist > SM.cfg.maxStopPct / 100) c.skip = `stop would be ${(r.dist * 100).toFixed(0)}% away`;
    else if (r.dist < 0.006) c.skip = 'stop too tight (< 0.6%) for fees and slippage';   // only reachable with the minimum stop distance set to 0
    else if (!tk || tk.qv < SM.cfg.minVol) c.skip = `24h volume under ${fmtUsd(SM.cfg.minVol)}`;
    else if (SM.cfg.unlGuard && r.dir === 'L' && u.phase === 'ahead' && u.big && u.days <= PT.cfg.unlDays) c.skip = `token unlock ${unlWhen(u)}: no longs into new supply`;
    else if (SM.cfg.unlGuard && r.dir === 'S' && u.phase === 'after' && u.big && u.hours <= 24) c.skip = `unlock was ${unlWhen(u)}: no fresh shorts for 24 h`;
    if (!c.skip && typeof screenGate === 'function') { const g = screenGate(s, 'smc'); if (g && g.skip) c.skip = g.skip; else if (g) c.scr = g; }
    c.fitR = c.scr ? c.scr.fit.hit.length / c.scr.fit.of : 0;
    cands.push(c);
  }
  for (const s of Object.keys(S.trk)) if (!S.smC.has(s)) S.smC.set(s, smcRead(s));
  if (SM.on && !SM.paused) {
    cands.sort((a, b) => b.fitR - a.fitR || ((b.r.q || {}).score || 0) - ((a.r.q || {}).score || 0) || b.r.score - a.r.score || b.r.rr - a.r.rr);
    for (const c of cands) {
      if (c.skip) continue;
      if (Object.keys(SM.pos).length >= SM.cfg.maxPos) { c.skip = `max ${SM.cfg.maxPos} positions open`; continue; }
      if (smTryEnter(c)) c.took = true;
    }
  }
  SM.lastScan = {t, cands: cands.map(c => ({b: c.b, side: c.side, score: c.r.score, rr: c.r.rr, zone: c.r.zone.kind, type: (c.r.setup || {}).type || 'rev', tf: c.r.tf, q: c.r.q ? c.r.q.grade : null, htf: c.r.bias || null, reg: c.r.regime ? c.r.regime.reg : null, took: !!c.took, skip: c.skip || (SM.on ? '' : 'trading is off')}))};
  const last = SM.eqs[SM.eqs.length - 1];
  if (!last || t - last[0] >= 5 * 60e3) { SM.eqs.push([t, +smEquity().toFixed(2)]); if (SM.eqs.length > 3000) SM.eqs.shift(); }
  smSave();
}

/* ---- stability comparison (works for any account: PT or SM) ---- */
function acctStats(A, eqNow) {
  const L = [...A.log].reverse(), R = L.map(x => x.R), n = R.length, mean = n ? R.reduce((a, b) => a + b, 0) / n : null;
  const sd = n > 1 ? Math.sqrt(R.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const gw = L.filter(x => x.pnl > 0).reduce((a, x) => a + x.pnl, 0), gl = -L.filter(x => x.pnl <= 0).reduce((a, x) => a + x.pnl, 0);
  let streak = 0, worstStreak = 0; for (const r of R) { streak = r <= 0 ? streak + 1 : 0; worstStreak = Math.max(worstStreak, streak); }
  const pts = A.eqs.concat([[now(), eqNow]]);
  let peak = A.start, dd = 0, under = 0, longest = 0, uStart = null;
  for (let i = 0; i < pts.length; i++) {
    const [t, v] = pts[i];
    if (v >= peak) { peak = v; if (uStart != null) { longest = Math.max(longest, t - uStart); uStart = null; } }
    else { if (uStart == null) uStart = t; if (i) under += t - pts[i - 1][0]; }
    dd = Math.min(dd, v / peak - 1);
  }
  if (uStart != null) longest = Math.max(longest, now() - uStart);
  const span = pts.length > 1 ? pts[pts.length - 1][0] - pts[0][0] : 0, ret = (eqNow / A.start - 1) * 100;
  return {n, win: n ? R.filter(r => r > 0).length / n * 100 : null, avgR: mean, sdR: sd, cons: sd ? mean / sd : null, pf: gl ? gw / gl : (gw ? Infinity : null),
    ret, dd: dd * 100, retDD: dd < 0 ? ret / (-dd * 100) : null, worst: n ? Math.min(...R) : null, streak: worstStreak, underPct: span ? under / span * 100 : 0, longestH: longest / 3600e3, days: span / 864e5};
}
function compareVerdict(a, b) {
  const minN = 15;
  if (a.n < minN || b.n < minN) return {t: `Too early to call: ${a.n} vs ${b.n} closed trades. Stability needs at least ${minN} trades each, ideally 30+ over a couple of weeks.`, who: null};
  const tests = [['smaller max drawdown', a.dd > b.dd], ['steadier results per trade (lower R spread)', a.sdR < b.sdR], ['shorter worst losing streak', a.streak < b.streak], ['less time underwater', a.underPct < b.underPct], ['better return per unit of drawdown', (a.retDD || -9) > (b.retDD || -9)]];
  const wa = tests.filter(x => x[1]).length, wb = tests.length - wa;
  const who = wa > wb ? 'Trader' : wb > wa ? 'SMC Trader' : null;
  return {t: who ? `${who} has been more stable so far: wins ${Math.max(wa, wb)} of ${tests.length} stability measures (${tests.filter(x => x[1] === (who === 'Trader')).map(x => x[0]).join(', ')}).` : 'Too close to call: each wins some stability measures.', who};
}

// the SMC rules in force: your settings, plus the Reviewer's SMC-concept adjustments when learning is on (RV.smAdj)
function smRules() {
  const c = SM.cfg, A = (SM.cfg.learn && typeof RV !== 'undefined' && RV.smAdj) || {};
  return {minQ: Math.max(c.minQ, A.minQ || 0), needHTF: !!A.needHTF, needPOI: !!A.needPOI, needDraw: !!A.needDraw, noCont: !!A.noCont, fvgOnly: !!A.fvgOnly, needDepth: !!A.needDepth, noTf: A.noTf || null,
    stopBuf: A.stopBuf || c.stopBuf, tp1R: A.tp1R || c.tp1R, riskMul: A.riskMul || 1, zone: A.zone || null};
}

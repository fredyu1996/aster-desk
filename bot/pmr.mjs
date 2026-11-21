// GMS PMR v1.4: Pattern-Anchored Multi-timeframe Refinement (Fred, Nov 21). RESEARCH / BACKTEST ONLY.
// Nothing here places orders, reads or writes the shared accounts, or runs in the cloud trader. Rules: docs/pmr-v1.4.md.
//
// Chain: a CONFIRMED 1h pattern (closed breakout bar beyond a boundary drawn from pivots known BEFORE that bar)
//   → 15m POI (OB or FVG) caused by the breakout impulse, near the boundary, fresh
//   → first 5m touch of that POI after the 1h confirmation
//   → 5m MSS (close beyond a confirmed swing) with a displacement candle, then the FIRST new 5m FVG of that leg
//   → limit order at the FVG midpoint, active only after the FVG's third candle closed, 60 min to fill (1m bars)
//   → hard stop / target / 24 h time exit on 1m bars, stop first when a minute touches both.
//
// Look-ahead guard: every read of a bar goes through View.b(i), which throws LookAhead for a bar not closed at the view's time.
// ATR and pivots are precomputed on the whole series, but ATR(i) only uses bars < i and a pivot is visible only once its
// confirming bar (i + R) is closed, so a view never sees anything a live run could not. tools/pmr-backtest.mjs re-runs every
// trade on series cut at its decision times and checks the outputs are identical.
// All times are ms since epoch, UTC; a bar's event time is its CLOSE (open + interval).

export const M1 = 60e3, M5 = 300e3, M15 = 900e3, H1 = 3600e3, H4 = 4 * H1;
export const P = {
  atrN: 14, piv1h: 3, piv15: 3, piv5: 3, piv4h: 2,           // pivots: left = right = R bars
  brkATR: 0.10,                                              // 1h close beyond the boundary by >= 0.10 ATR1h (prior)
  poiLook: 8, poiExtra: 2, poiNonCausal: 32,                 // 15m impulse window at t0; 2 more 15m bars for a continuation impulse; older ones logged as not causal
  dispBody: 1.20, dispRatio: 0.60, fvgMin: 0.10,             // displacement: body >= 1.2 ATR (prior), body/range >= 0.6; FVG width >= 0.10 ATR before C2
  poiMaxDist: 0.50,                                          // POI to the 1h boundary <= 0.5 ATR1h
  bosBars: 2,                                                // 15m BOS: the impulse bar or one of the next 2 closes beyond the last confirmed 15m swing
  retestMin: 120, mssMin: 45, fvgAfterMssMin: 15, pendMin: 60,
  mssBuf: 0.05, stopBuf: 0.15, minNetRR: 2.0, holdH: 24, oppLook1h: 200, oppUnswept: 1,
  feePct: 0.04, spreadPct: 0.01, slipPct: 0.02,              // per side; slippage only on stop / time exits (market orders)
  aPlusOverlap: 0.20, sweepLook5: 12,
  pat: {
    win: 60,
    dt: {gapMin: 5, gapMax: 40, tol: 0.6, minH: 1.5, prior: 2, priorLook: 24, maxAge: 30, newExt: 0.3},
    hns: {span: 60, gap: 3, headOver: 0.3, shTol: 1.5, neckTol: 1.5, prior: 2, priorLook: 24, maxAge: 20},
    tri: {win: 48, flat: 0.3, minSpan: 8, minW: 0.3, maxAge: 24, tol: 0.1, lineSpan: 0.4, startGap: 0.5},   // each line spans >= 40% of the triangle; the two lines start within half of it
    flag: {pole: 3, poleBars: 12, minBars: 4, maxBars: 25, retr: 0.5},
  },
};
export const REV = new Set(['DOUBLE_TOP', 'DOUBLE_BOTTOM', 'HNS', 'INVERSE_HNS']);

export class LookAhead extends Error {}
const iso = t => new Date(t).toISOString().slice(0, 16) + 'Z';

/* ---------------- series, views, ATR, pivots ---------------- */
// a[i] = Wilder ATR from true ranges of bars 1..i-1 (never bar i itself): "ATR prior" of bar i
export function atrPrior(B, n = P.atrN) {
  const a = new Float64Array(B.length).fill(NaN); let atr = NaN, cnt = 0, sum = 0;
  for (let i = 1; i < B.length; i++) {
    a[i] = atr;
    const tr = Math.max(B[i][2] - B[i][3], Math.abs(B[i][2] - B[i - 1][4]), Math.abs(B[i][3] - B[i - 1][4]));
    if (cnt < n) { sum += tr; if (++cnt === n) atr = sum / n; } else atr = (atr * (n - 1) + tr) / n;
  }
  return a;
}
// pivot at i: high strictly above the L bars before, >= the R bars after. k = i + R = the bar whose close confirms it.
export function pivots(B, L, R) {
  const hi = [], lo = [];
  for (let i = L; i < B.length - R; i++) {
    let isH = true, isL = true;
    for (let k = i - L; k <= i + R && (isH || isL); k++) {
      if (k === i) continue;
      if (k < i) { if (B[k][2] >= B[i][2]) isH = false; if (B[k][3] <= B[i][3]) isL = false; }
      else { if (B[k][2] > B[i][2]) isH = false; if (B[k][3] < B[i][3]) isL = false; }
    }
    if (isH) hi.push({i, p: B[i][2], k: i + R}); if (isL) lo.push({i, p: B[i][3], k: i + R});
  }
  return {hi, lo};
}
export class Series {
  constructor(B, ms, R) { this.B = B; this.ms = ms; this.atr = atrPrior(B); this.pv = pivots(B, R, R); }
  n(T) { let lo = 0, hi = this.B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (this.B[m][0] + this.ms <= T) lo = m + 1; else hi = m; } return lo; }
  view(T) { return new View(this, this.n(T), T); }
  cut(T) { return new Series(this.B.slice(0, this.n(T)), this.ms, this.R0); }
}
export function mkSeries(B, ms, R) { const s = new Series(B, ms, R); s.R0 = R; return s; }
export class View {
  constructor(S, n, T) { this.S = S; this.n = n; this.T = T; }
  b(i) { if (i < 0 || i >= this.n) throw new LookAhead(`bar ${i} (n ${this.n}) read at ${iso(this.T)}`); return this.S.B[i]; }
  atr(i) { if (i < 0 || i >= this.n) throw new LookAhead(`ATR ${i} read at ${iso(this.T)}`); return this.S.atr[i]; }   // ATR before bar i (bars < i)
  ct(i) { return this.b(i)[0] + this.S.ms; }   // close time of a closed bar
  // pivots of a kind confirmed by bar maxK (default: the last closed bar), newest last
  piv(kind, maxK = this.n - 1) {
    const a = this.S.pv[kind], lim = Math.min(this.n - 1, maxK); let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].k <= lim) lo = m + 1; else hi = m; }
    return {a, end: lo};
  }
  recentPiv(kind, maxK, minI) { const {a, end} = this.piv(kind, maxK), out = []; for (let x = end - 1; x >= 0 && a[x].i >= minI; x--) out.unshift(a[x]); return out; }
}
const isDisp = (b, atr, s) => { const body = b[4] - b[1], rng = b[2] - b[3]; return s * body > 0 && Math.abs(body) >= P.dispBody * atr && rng > 0 && Math.abs(body) / rng >= P.dispRatio; };
const lineAt = (L, i) => L.p1 + (i - L.i1) * L.slope;
const mkLine = (i1, p1, i2, p2) => ({i1, p1, slope: i2 === i1 ? 0 : (p2 - p1) / (i2 - i1)});
const hLine = (i1, p1) => ({i1, p1, slope: 0});

/* ---------------- 4h bias (closed 4h bars only, built from 1h) ---------------- */
export function mk4h(B1) {
  const out = []; let cur = null;
  for (const b of B1) {
    const t = Math.floor(b[0] / H4) * H4;
    if (!cur || cur[0] !== t) { if (cur && cur.n === 4) out.push(cur.slice(0, 5)); cur = [t, b[1], b[2], b[3], b[4]]; cur.n = 1; }
    else { cur[2] = Math.max(cur[2], b[2]); cur[3] = Math.min(cur[3], b[3]); cur[4] = b[4]; cur.n++; }
  }
  if (cur && cur.n === 4) out.push(cur.slice(0, 5));
  return out;
}
export function bias4h(S4, T) {
  const V = S4.view(T), h = V.recentPiv('hi', V.n - 1, 0).slice(-2), l = V.recentPiv('lo', V.n - 1, 0).slice(-2);
  if (h.length < 2 || l.length < 2) return 'range';
  const hh = h[1].p > h[0].p, hl = l[1].p > l[0].p;
  return hh && hl ? 'up' : !hh && !hl ? 'down' : 'range';
}

/* ---------------- 1h pattern anchor ---------------- */
// Checks the LAST CLOSED 1h bar at time T for a breakout of a pattern whose pivots were all confirmed before that bar.
// Returns {ev, waits}: ev = frozen event or null; waits = near misses with their reason (WICK_ONLY / BREAKOUT_TOO_SMALL).
export function detect1h(S1, T, sym = '', S4 = null) {
  const V = S1.view(T), j = V.n - 1, waits = [], found = [];
  if (j < 40) return {ev: null, waits: [{reason: 'WARMUP'}]};
  const atr1 = V.atr(j); if (!(atr1 > 0)) return {ev: null, waits: [{reason: 'WARMUP'}]};
  const bj = V.b(j), C = i => V.b(i)[4], Hh = i => V.b(i)[2], Ll = i => V.b(i)[3];
  const minLow = (a, b) => { let m = Infinity, ix = -1; for (let x = a; x <= b; x++) if (Ll(x) < m) { m = Ll(x); ix = x; } return [m, ix]; };
  const maxHigh = (a, b) => { let m = -Infinity, ix = -1; for (let x = a; x <= b; x++) if (Hh(x) > m) { m = Hh(x); ix = x; } return [m, ix]; };
  // breakout test on bar j against boundary line L in direction s (+1 up / -1 down)
  const brk = (type, dir, L, extra) => {
    const s = dir === 'L' ? 1 : -1, bnd = lineAt(L, j), over = s * (bj[4] - bnd);
    if (over >= P.brkATR * atr1) { found.push(Object.assign({type, dir, line: L, bnd}, extra)); return; }
    if (over > 0) waits.push({type, dir, reason: 'BREAKOUT_TOO_SMALL'});
    else if (s * ((s > 0 ? bj[2] : bj[3]) - bnd) > 0) waits.push({type, dir, reason: 'WICK_ONLY'});
  };
  const intact = (from, to, L, s) => { for (let x = from; x <= to; x++) if (s * (C(x) - lineAt(L, x)) > 0) return false; return true; };
  const hiP = V.recentPiv('hi', j - 1, j - P.pat.win), loP = V.recentPiv('lo', j - 1, j - P.pat.win);

  // H&S / inverse: last three confirmed pivots of a side; sloped neckline through the two troughs (peaks), evaluated at each bar
  for (const [type, dir, ps, s] of [['HNS', 'S', hiP, 1], ['INVERSE_HNS', 'L', loP, -1]]) {
    const q = P.pat.hns; if (ps.length < 3) continue;
    const [A, Hd, Cc] = ps.slice(-3), atr = V.atr(Cc.i); if (!(atr > 0)) continue;
    if (Cc.i - A.i > q.span || Hd.i - A.i < q.gap || Cc.i - Hd.i < q.gap || j - Cc.i > q.maxAge) continue;
    if (s * (Hd.p - A.p) < q.headOver * atr || s * (Hd.p - Cc.p) < q.headOver * atr || Math.abs(A.p - Cc.p) > q.shTol * atr) continue;
    const [t1p, t1] = s > 0 ? minLow(A.i + 1, Hd.i - 1) : maxHigh(A.i + 1, Hd.i - 1), [t2p, t2] = s > 0 ? minLow(Hd.i + 1, Cc.i - 1) : maxHigh(Hd.i + 1, Cc.i - 1);
    if (t1 < 0 || t2 < 0 || Math.abs(t2p - t1p) > q.neckTol * atr) continue;
    const neck = mkLine(t1, t1p, t2, t2p);
    if (s * (A.p - lineAt(neck, A.i)) <= 0 || s * (Cc.p - lineAt(neck, Cc.i)) <= 0) continue;
    const pr = s > 0 ? minLow(Math.max(0, A.i - q.priorLook), A.i)[0] : maxHigh(Math.max(0, A.i - q.priorLook), A.i)[0];
    if (s * (A.p - pr) < q.prior * atr) continue;
    let ok = true; for (let x = Cc.i + 1; x < j; x++) if (s * ((s > 0 ? Hh(x) : Ll(x)) - Hd.p) > 0) { ok = false; break; }   // no new head since
    if (!ok || !intact(Cc.i + 1, j - 1, neck, -s)) continue;
    const height = Math.abs(Hd.p - lineAt(neck, Hd.i));
    brk(type, dir, neck, {height, inval: Hd.p, piv: [A, Hd, Cc].map(p => p.i), mm: lineAt(neck, j) - s * height});
  }
  // double top / bottom: last two confirmed pivots of a side, horizontal neckline at the extreme between them
  for (const [type, dir, ps, s] of [['DOUBLE_TOP', 'S', hiP, 1], ['DOUBLE_BOTTOM', 'L', loP, -1]]) {
    const q = P.pat.dt; if (ps.length < 2) continue;
    const [A, B] = ps.slice(-2), atr = V.atr(B.i); if (!(atr > 0)) continue;
    if (B.i - A.i < q.gapMin || B.i - A.i > q.gapMax || j - B.i > q.maxAge || Math.abs(A.p - B.p) > q.tol * atr) continue;
    const [N] = s > 0 ? minLow(A.i + 1, B.i - 1) : maxHigh(A.i + 1, B.i - 1), top = s > 0 ? Math.max(A.p, B.p) : Math.min(A.p, B.p);
    const height = Math.abs(top - N); if (height < q.minH * atr) continue;
    const pr = s > 0 ? minLow(Math.max(0, A.i - q.priorLook), A.i)[0] : maxHigh(Math.max(0, A.i - q.priorLook), A.i)[0];
    if (s * (A.p - pr) < q.prior * atr) continue;
    let ok = true; for (let x = B.i + 1; x < j; x++) if (s * ((s > 0 ? Hh(x) : Ll(x)) - top) > q.newExt * atr) { ok = false; break; }
    const neck = hLine(B.i, N);
    if (!ok || !intact(B.i + 1, j - 1, neck, -s)) continue;
    brk(type, dir, neck, {height, inval: top, piv: [A.i, B.i], mm: N - s * height});
  }
  // triangles: last two confirmed highs and lows; ascending (flat top, rising lows), descending (flat bottom, falling highs), symmetrical (both converge).
  // Either breakout direction counts; the direction comes only from the closed breakout bar.
  { const q = P.pat.tri, hs = V.recentPiv('hi', j - 1, j - q.win).slice(-2), ls = V.recentPiv('lo', j - 1, j - q.win).slice(-2);
    if (hs.length === 2 && ls.length === 2) {
      const first = Math.min(hs[0].i, ls[0].i), last = Math.max(hs[1].i, ls[1].i), atr = V.atr(last);
      const span = last - first, spanOk = hs[1].i - hs[0].i >= q.lineSpan * span && ls[1].i - ls[0].i >= q.lineSpan * span && Math.abs(hs[0].i - ls[0].i) <= q.startGap * span;
      if (atr > 0 && span >= q.minSpan && spanOk && j - last <= q.maxAge) {
        const U = mkLine(hs[0].i, hs[0].p, hs[1].i, hs[1].p), Lw = mkLine(ls[0].i, ls[0].p, ls[1].i, ls[1].p);
        const dH = hs[1].p - hs[0].p, dL = ls[1].p - ls[0].p, flatH = Math.abs(dH) <= q.flat * atr, flatL = Math.abs(dL) <= q.flat * atr;
        const kind = flatH && dL > q.flat * atr ? 'ASC' : flatL && dH < -q.flat * atr ? 'DESC' : dH < -q.flat * atr && dL > q.flat * atr ? 'SYM' : null;
        const w0 = lineAt(U, first) - lineAt(Lw, first), wE = lineAt(U, j - 1) - lineAt(Lw, j - 1);
        if (kind && w0 > wE && wE >= q.minW * atr) {
          let ok = true; for (let x = first; x < j; x++) if (C(x) > lineAt(U, x) + q.tol * atr || C(x) < lineAt(Lw, x) - q.tol * atr) { ok = false; break; }
          if (ok) {
            brk('TRIANGLE', 'L', U, {sub: kind, height: w0, inval: lineAt(Lw, j), piv: [hs[0].i, hs[1].i, ls[0].i, ls[1].i], mm: lineAt(U, j) + w0});
            brk('TRIANGLE', 'S', Lw, {sub: kind, height: w0, inval: lineAt(U, j), piv: [hs[0].i, hs[1].i, ls[0].i, ls[1].i], mm: lineAt(Lw, j) - w0});
          }
        }
      }
    } }
  // flags: a pole of >= 3 ATR within 12 bars into the flag top A (the extreme pivot of the flag), then 4-25 bars of pullback of
  // <= 50% of the pole that closes inside a boundary through A and the latest lower pivot of the same side (horizontal when none)
  for (const [dir, ps, s] of [['L', hiP, 1], ['S', loP, -1]]) {
    const q = P.pat.flag;
    for (let x = ps.length - 1; x >= 0; x--) {
      const A = ps[x], a = A.i; if (j - a > q.maxBars) break; if (j - a < q.minBars) continue;
      const atr = V.atr(a); if (!(atr > 0)) continue;
      const [ext] = s > 0 ? maxHigh(a + 1, j - 1) : minLow(a + 1, j - 1); if (s * (ext - A.p) > 0) continue;   // A must be the flag's extreme
      const [pe] = s > 0 ? minLow(Math.max(0, a - q.poleBars), a - 1) : maxHigh(Math.max(0, a - q.poleBars), a - 1), pole = s * (A.p - pe);
      if (pole < q.pole * atr) continue;
      const [fx] = s > 0 ? minLow(a + 1, j - 1) : maxHigh(a + 1, j - 1);
      if (s * (A.p - fx) > q.retr * pole) continue;
      const later = ps.filter(p => p.i > a), A2 = later[later.length - 1];
      const L = A2 ? mkLine(a, A.p, A2.i, A2.p) : hLine(a, A.p);
      if (!intact(a + 1, j - 1, L, s)) continue;
      brk(dir === 'L' ? 'BULL_FLAG' : 'BEAR_FLAG', dir, L, {height: pole, inval: fx, piv: A2 ? [a, A2.i] : [a], mm: lineAt(L, j) + s * pole});
      break;
    }
  }
  if (!found.length) return {ev: null, waits};
  const pr = ['HNS', 'INVERSE_HNS', 'DOUBLE_TOP', 'DOUBLE_BOTTOM', 'TRIANGLE', 'BULL_FLAG', 'BEAR_FLAG'];
  found.sort((x, y) => pr.indexOf(x.type) - pr.indexOf(y.type));
  const f = found[0], T0 = V.ct(j), bias = S4 ? bias4h(S4, T0) : 'range';
  const want = f.dir === 'L' ? 'up' : 'down';
  const ev = Object.freeze({
    pattern_id: `${sym}|${f.type}|${f.dir}|${iso(T0)}`, sym, type: f.type, sub: f.sub || null, dir: f.dir, confirmed_at: T0, bar: j,
    boundary: Object.freeze({i1: f.line.i1, t1: V.b(f.line.i1)[0], p1: f.line.p1, slope: f.line.slope}), boundary_at_t: f.bnd,
    atr1h: atr1, height: f.height, target_pre: f.mm, inval: f.inval, piv: Object.freeze(f.piv.slice()),
    bias4h: bias, group: REV.has(f.type) ? (bias === want ? 'TREND' : 'COUNTERTREND_ALLOWED') : (bias === want ? 'TREND' : bias === 'range' ? 'RANGE_4H' : 'AGAINST_4H'),
    also: found.slice(1).map(x => x.type + ':' + x.dir),
  });
  return {ev, waits};
}

/* ---------------- 15m causal POI ---------------- */
// Zones caused by a displacement impulse in the pattern's direction among the last poiLook 15m bars at t0 (plus continuation impulses
// that become known in the next poiExtra bars: only zones with known_at > t0 count then). FVG: C2 = the impulse, needs C3 closed.
// OB: the last opposite-colour candle 1-4 bars before the impulse, only when a 15m close broke the last confirmed swing (BOS) within
// bosBars of the impulse; known when that BOS bar closed. Each zone: distance to the boundary <= 0.5 ATR1h and untouched since known.
export function findPois(S15, ev, asof) {
  const V = S15.view(asof), T0 = ev.confirmed_at, s = ev.dir === 'L' ? 1 : -1, cands = [], n = V.n;
  const wStart = T0 - P.poiLook * M15, ncStart = T0 - P.poiNonCausal * M15, cont = asof > T0;
  for (let k = Math.max(4, n - P.poiNonCausal - 2 * P.poiExtra - 2); k < n; k++) {
    const b = V.b(k), ck = V.ct(k), atr = V.atr(k);
    if (!(atr > 0) || ck <= ncStart) continue;
    const disp = isDisp(b, atr, s), dispOpp = isDisp(b, atr, -s);
    if (!disp && !dispOpp) continue;
    const zones = [];
    if (k + 1 < n) {   // FVG with C2 = k (C3 closed), in the impulse's own direction
      const c1 = V.b(k - 1), c3 = V.b(k + 1), ss = disp ? s : -s, glo = ss > 0 ? c1[2] : c3[2], ghi = ss > 0 ? c3[3] : c1[3];
      if (ghi - glo >= P.fvgMin * atr) zones.push({type: 'FVG', lo: glo, hi: ghi, known_at: V.ct(k + 1), kIdx: k + 1});
    }
    // BOS + OB (only for the pattern's direction; an opposite impulse is logged as not causal anyway)
    let bos = null;
    if (disp) for (let m = k; m <= Math.min(k + P.bosBars, n - 1) && !bos; m++) {
      const piv = V.recentPiv(s > 0 ? 'hi' : 'lo', m - 1, 0).filter(p => p.i < k).pop();
      if (piv && s * (V.b(m)[4] - piv.p) > 0) bos = {m, p: piv.p};
    }
    let obNote = null;
    if (bos) {
      let x = -1; for (let y = k - 1; y >= k - 4; y--) { const c = V.b(y); if (s * (c[4] - c[1]) < 0) { x = y; break; } }
      if (x >= 0) { const c = V.b(x); zones.push({type: 'OB', lo: c[3], hi: c[2], known_at: V.ct(bos.m), kIdx: bos.m, obBar: x}); }
      else obNote = 'NO_OB_CANDLE';
    } else obNote = 'NO_BOS';
    for (const z of zones) {
      const c = Object.assign(z, {impulse_at: ck, k, obNote: z.type === 'FVG' ? obNote : null});
      if (dispOpp && !disp) c.status = 'SKIP_POI_NOT_CAUSAL';
      else if (ck <= wStart) c.status = 'SKIP_POI_NOT_CAUSAL';
      else if (cont && c.known_at <= T0) continue;           // judged at t0 already
      else if (c.known_at > asof) continue;                   // not known yet (cannot happen: kIdx < n) – kept as a guard
      else {
        const d = Math.max(0, c.lo - ev.boundary_at_t, ev.boundary_at_t - c.hi); c.dist = d / ev.atr1h;
        if (d > P.poiMaxDist * ev.atr1h) c.status = 'SKIP_POI_TOO_REMOTE';
        else {
          let used = null; for (let y = c.kIdx + 1; y < n; y++) { const bb = V.b(y); if (s > 0 ? bb[3] <= c.hi : bb[2] >= c.lo) { used = V.ct(y); break; } }
          c.status = used ? 'SKIP_USED_ZONE' : 'OK'; if (used) c.used_at = used;
        }
      }
      cands.push(c);
    }
  }
  const ok = cands.filter(c => c.status === 'OK').sort((x, y) => x.dist - y.dist || y.known_at - x.known_at);
  const best = ok[0] || null;
  let conf = false;
  if (best) for (const o of ok) if (o.type !== best.type) { const ov = Math.min(best.hi, o.hi) - Math.max(best.lo, o.lo); if (ov >= P.aPlusOverlap * Math.min(best.hi - best.lo, o.hi - o.lo)) conf = true; }
  return {cands, best, conf};
}

/* ---------------- costs ---------------- */
export function netRR(side, entry, stop, target, c = P) {
  const f = (c.feePct + c.spreadPct) / 100, sl = c.slipPct / 100, s = side === 'L' ? 1 : -1;
  const risk = s * (entry - stop), reward = s * (target - entry);
  const costTP = entry * f + target * f, costSL = entry * f + stop * (f + sl);
  return {gross: reward / risk, net: (reward - costTP) / (risk + costSL)};
}
// Exit on 1m bars from the fill minute. Fill minute: only the stop counts (the order of fill and later prices inside it is unknown).
// A later minute touching both stop and target: stop first. Time exit at fill + holdH, at that minute's close, with slippage.
export function simExit(m1, fi, side, entry, stop, target, fillT, holdH = P.holdH) {
  const s = side === 'L' ? 1 : -1, end = fillT + holdH * H1;
  for (let x = fi; x < m1.length; x++) {
    const b = m1[x]; if (b[0] >= end) { const pb = m1[x - 1]; return {why: 'TIME', px: pb[4], t: pb[0] + M1}; }
    const hitS = s > 0 ? b[3] <= stop : b[2] >= stop, hitT = s > 0 ? b[2] >= target : b[3] <= target;
    if (hitS) return {why: 'STOP', px: stop, t: b[0] + M1};
    if (hitT && x > fi) return {why: 'TARGET', px: target, t: b[0] + M1};
  }
  return null;   // data ends before the trade did (open at the end; not counted)
}
export function realR(tr, funding = [], c = P) {
  const s = tr.dir === 'L' ? 1 : -1, f = (c.feePct + c.spreadPct) / 100, sl = c.slipPct / 100;
  const exitPx = tr.exit.why === 'TARGET' ? tr.exit.px : tr.exit.px * (1 - s * sl);
  let pnl = s * (exitPx - tr.entry) - tr.entry * f - exitPx * f, fund = 0;
  for (const [t, r] of funding) if (t > tr.fill_at && t <= tr.exit.t) fund += s * r * tr.entry;
  pnl -= fund;
  return {R: pnl / Math.abs(tr.entry - tr.stop), fundR: -fund / Math.abs(tr.entry - tr.stop)};
}

/* ---------------- one setup, event by event ---------------- */
// Walks the 5m clock from t0. At each 5m close t: (1) intrabar fills / nothing else (exits are handled after the fill),
// (2) 1h close: pre-entry invalidation (close back inside the boundary), (3) 15m close: POI far-edge invalidation and
// continuation POI search, (4) 5m: retest, MSS, entry FVG, pending order. Returns the setup with its event log.
// getM1(from, to) → 1m bars with open in [from, to). until: stop at that time (look-ahead check on truncated data).
export async function runSetup(ev, D, getM1, until = Infinity) {
  const {S1, S15, S5} = D, s = ev.dir === 'L' ? 1 : -1, T0 = ev.confirmed_at, log = [], R = {ev, log, status: 'PATTERN_CONFIRMED'};
  const emit = (t, code, x) => log.push(Object.assign({t, code}, x || {}));
  emit(T0, 'PATTERN_CONFIRMED', {type: ev.type, dir: ev.dir, boundary: +ev.boundary_at_t.toPrecision(8)});
  const end = (t, code, x) => { R.status = code; R.end_at = t; emit(t, code, x); return R; };
  let poi = findPois(S15, ev, T0);
  R.cands = poi.cands.map(c => ({type: c.type, status: c.status, known_at: c.known_at}));
  for (const c of poi.cands) if (c.status !== 'OK') emit(T0, c.status, {poi: c.type, known_at: c.known_at});
  if (poi.best) { R.parent = poi.best; R.conf = poi.conf; R.status = 'WAIT_RETEST'; emit(T0, 'POI_FROZEN', {poi: poi.best.type, lo: poi.best.lo, hi: poi.best.hi, known_at: poi.best.known_at}); }
  let u = -1, tTouch = 0, mssAt = 0, e = -1, ord = null;
  for (let t = T0 + M5; t <= T0 + 24 * H1; t += M5) {
    if (t > until) { R.cut_at = until; return R; }   // truncated-data replay: stop where the data stops
    // (1) pending order: 1m bars of the 5m bar that just closed, at or after active_after
    if (R.status === 'PENDING') {
      const m1 = await getM1(t - M5, t);
      for (const b of m1) {
        if (b[0] < ord.active_after) continue;
        if (s > 0 ? b[3] <= ord.entry : b[2] >= ord.entry) { ord.fill_at = b[0]; R.status = 'FILLED'; emit(b[0], 'FILLED', {entry: ord.entry}); return R; }
      }
      if (t >= ord.expires) return end(t, 'EXPIRED_NO_FILL');
    }
    // (2) 1h close back inside the pattern (pre-entry only)
    if (t % H1 === 0 && t > T0) {
      const V1 = S1.view(t), j = V1.n - 1, c = V1.b(j)[4], bnd = lineAt({i1: ev.boundary.i1, p1: ev.boundary.p1, slope: ev.boundary.slope}, j);
      if (s * (c - bnd) < 0) return end(t, R.status === 'PENDING' ? 'CANCELLED_PATTERN_INVALIDATED' : 'PATTERN_INVALIDATED', {close: c, boundary: bnd});
    }
    // (3) 15m close
    if (t % M15 === 0) {
      if (R.parent) {
        const V = S15.view(t), c = V.b(V.n - 1)[4];
        if (s * (c - (s > 0 ? R.parent.lo : R.parent.hi)) < 0) return end(t, R.status === 'PENDING' ? 'CANCELLED_POI_INVALIDATED' : 'PARENT_POI_INVALIDATED', {close: c});
      } else if (t <= T0 + P.poiExtra * M15) {
        poi = findPois(S15, ev, t);
        for (const c of poi.cands) if (c.known_at > T0 && c.status !== 'OK') emit(t, c.status, {poi: c.type, known_at: c.known_at});
        if (poi.best) { R.parent = poi.best; R.conf = poi.conf; R.status = 'WAIT_RETEST'; emit(t, 'POI_FROZEN', {poi: poi.best.type, lo: poi.best.lo, hi: poi.best.hi, known_at: poi.best.known_at, cont: true}); }
        else if (t === T0 + P.poiExtra * M15) return end(t, R.cands.length || poi.cands.length ? 'SKIP_POI' : 'NO_POI');
      }
    }
    if (!R.parent) { if (t > T0 + P.poiExtra * M15) return end(t, 'NO_POI'); continue; }
    // (4) 5m close
    const V5 = S5.view(t), v = V5.n - 1, b = V5.b(v);
    if (R.status === 'WAIT_RETEST') {
      if (t > T0 + P.retestMin * 60e3) return end(t, 'EXPIRED_NO_TOUCH');
      if (b[0] >= R.parent.known_at && (s > 0 ? b[3] <= R.parent.hi : b[2] >= R.parent.lo)) {
        u = v; tTouch = t; R.status = 'POI_TOUCHED'; emit(t, 'POI_TOUCHED', {px: s > 0 ? b[3] : b[2]});
        // a displacement FVG of the pattern's side that completed after t0 but before this touch can never be the entry FVG
        for (let c2 = v - 1; c2 >= 1 && V5.ct(c2 + 1) > T0; c2--) {
          const c1 = V5.b(c2 - 1), c3 = V5.b(c2 + 1), atr = V5.atr(c2), w = s > 0 ? c3[3] - c1[2] : c1[3] - c3[2];
          if (isDisp(V5.b(c2), atr, s) && w >= P.fvgMin * atr) { emit(t, 'REJECT_AS_ENTRY_FVG', {c3_closed_at: V5.ct(c2 + 1)}); break; }
        }
      } else continue;
    }
    if (R.status === 'POI_TOUCHED') {
      if (t > tTouch + P.mssMin * 60e3) return end(t, 'NO_LTF_CONFIRMATION');
      const sw = V5.recentPiv(s > 0 ? 'hi' : 'lo', v - 1, 0).pop();
      if (sw && s * (b[4] - sw.p) > P.mssBuf * V5.atr(v)) {
        let ex = u; for (let x = u; x <= v; x++) if (s > 0 ? V5.b(x)[3] < V5.b(ex)[3] : V5.b(x)[2] > V5.b(ex)[2]) ex = x;
        let disp = false; for (let x = ex; x <= v; x++) if (isDisp(V5.b(x), V5.atr(x), s)) { disp = true; break; }
        if (disp) { e = ex; mssAt = t; R.status = 'LTF_CONFIRMED'; emit(t, 'MSS_CONFIRMED', {swing: sw.p}); }
      }
    }
    if (R.status === 'LTF_CONFIRMED') {
      if (t > mssAt + P.fvgAfterMssMin * 60e3) return end(t, 'NO_ASSOCIATED_FVG');
      let fvg = null;
      for (let c2 = Math.max(u + 1, e); c2 + 1 <= v && !fvg; c2++) {
        const c1 = V5.b(c2 - 1), c3 = V5.b(c2 + 1), atr = V5.atr(c2), lo = s > 0 ? c1[2] : c3[2], hi = s > 0 ? c3[3] : c1[3];
        if (isDisp(V5.b(c2), atr, s) && hi - lo >= P.fvgMin * atr) fvg = {lo, hi, c3_closed_at: V5.ct(c2 + 1), c2};
      }
      if (!fvg) continue;
      const entry = (fvg.lo + fvg.hi) / 2;
      let ext = s > 0 ? Infinity : -Infinity; for (let x = u; x <= v; x++) ext = s > 0 ? Math.min(ext, V5.b(x)[3]) : Math.max(ext, V5.b(x)[2]);
      const far = s > 0 ? R.parent.lo : R.parent.hi, base = s > 0 ? Math.min(ext, far) : Math.max(ext, far), stop = base - s * P.stopBuf * V5.atr(v);
      // target: the pattern's measured move, or a nearer confirmed opposing 1h swing (known now)
      // opposing liquidity = confirmed 1h swings beyond the entry that no later closed 1h bar has traded through yet (oppUnswept 1);
      // oppUnswept 0 = every confirmed swing beyond the entry, swept or not (the literal reading)
      const V1 = S1.view(t), unswept = p => { if (!P.oppUnswept) return true; for (let x = p.i + 1; x < V1.n; x++) if (s * ((s > 0 ? V1.b(x)[2] : V1.b(x)[3]) - p.p) > 0) return false; return true; };
      const opp = V1.recentPiv(s > 0 ? 'hi' : 'lo', V1.n - 1, V1.n - 1 - P.oppLook1h).filter(p => s * (p.p - entry) > 0 && unswept(p));
      let target = ev.target_pre, tgtWhy = 'MEASURED_MOVE';
      for (const p of opp) if (s * (p.p - target) < 0) { target = p.p; tgtWhy = 'OPPOSING_1H_SWING'; }
      if (s * (target - entry) <= 0) return end(t, 'SKIP_RR', {why: 'target behind entry'});
      const rr = netRR(ev.dir, entry, stop, target);
      // A / A+ (research label only, never used for any decision)
      let sweep = false;
      { const pl = V5.recentPiv(s > 0 ? 'lo' : 'hi', v - 1, u - P.sweepLook5);
        for (let x = u; x <= v && !sweep; x++) for (const p of pl) if (p.k < x && (s > 0 ? V5.b(x)[3] < p.p && V5.b(x)[4] > p.p : V5.b(x)[2] > p.p && V5.b(x)[4] < p.p)) { sweep = true; break; } }
      R.order = ord = {entry, stop, target, tgtWhy, gross_rr: rr.gross, net_rr: rr.net, fvg, mss_confirmed_at: mssAt, first_retest_at: tTouch,
        active_after: t, expires: t + P.pendMin * 60e3, grade: R.conf && sweep ? 'A_PLUS_CANDIDATE' : 'A', sweep, research_label_only: true};
      if (rr.net < P.minNetRR) return end(t, 'SKIP_RR', {gross: +rr.gross.toFixed(2), net: +rr.net.toFixed(2)});
      R.status = 'PENDING'; emit(t, 'PENDING', {entry, stop, target, net_rr: +rr.net.toFixed(2)});
    }
  }
  return end(T0 + 24 * H1, 'TIMEOUT');
}

// JSON output contract (spec section 9) for a setup that reached an order
export function contract(R) {
  const ev = R.ev, o = R.order || {}, p = R.parent || {}, other = R.cands || [];
  const ob = p.type === 'OB' ? [p.lo, p.hi] : null, fvg = p.type === 'FVG' ? [p.lo, p.hi] : null;
  return {
    strategy: 'GMS_PMR_1H_v1.4', symbol: ev.sym, pattern_tf: '1h', pattern_type: ev.type + (ev.sub ? '_' + ev.sub : ''), pattern_id: ev.pattern_id,
    pattern_confirmed_at: new Date(ev.confirmed_at).toISOString(), breakout_boundary_at_confirmation: ev.boundary_at_t, direction: ev.dir === 'L' ? 'LONG' : 'SHORT',
    parent_poi_tf: '15m', parent_ob_bounds: ob, parent_fvg_bounds: fvg, parent_known_at: p.known_at ? new Date(p.known_at).toISOString() : null, parent_fresh_at_t0: !!R.parent,
    first_retest_at: o.first_retest_at ? new Date(o.first_retest_at).toISOString() : null, mss_tf: '5m', mss_confirmed_at: o.mss_confirmed_at ? new Date(o.mss_confirmed_at).toISOString() : null,
    entry_fvg_bounds: o.fvg ? [o.fvg.lo, o.fvg.hi] : null, entry_fvg_c3_closed_at: o.fvg ? new Date(o.fvg.c3_closed_at).toISOString() : null,
    entry: o.entry ?? null, stop: o.stop ?? null, target: o.target ?? null, gross_rr: o.gross_rr ?? null, net_rr_estimate: o.net_rr ?? null,
    grade: o.grade || null, group: ev.group, bias4h: ev.bias4h, status: R.status, n_poi_candidates: other.length,
    action: R.status === 'PENDING' || R.status === 'FILLED' ? 'PAPER_ORDER_RESEARCH_ONLY' : 'NONE',
  };
}

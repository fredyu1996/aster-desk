// SMC Trader nightly backtest (spec: docs/superpowers/specs/2026-11-13-smc-backtest-design.md). REPORT ONLY (Fred, Nov 13):
// nothing here changes live rules or the shared account. It re-runs the SMC Trader with the current live cfg + the Reviewer's
// SMC rules (RV.smAdj, minus the locked zone weights) over the last BT_DAYS days, on the coins the tracker would have followed
// then, stepping at each 5m close. At step T the tracker and the strategy only see bars closed by T (plus the forming 15m / 1h
// bar built from closed 5m bars); a position is managed on the 5m candles after its entry, adverse extreme first.
// Variants: base · zone (the proposed smZoneTune weights unlocked) · noObQ (order blocks without the obQ bar).
// Env: DATA_REPO, DATA_TOKEN (reads branch "state", writes branch "backtest" as one parentless commit), BT_DAYS (default 7).
// Local, no GitHub at all: STATE_IN=<state.json> BT_OUT=<out.json> [BT_DAYS=2] node bot/backtest.mjs   (after build.py)
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import {fileURLToPath} from 'node:url';

process.env.TZ ||= 'America/Creston';   // the daily loss limit resets at Creston midnight, as in the cloud
const DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO = process.env.DATA_REPO, TOKEN = process.env.DATA_TOKEN, LOCAL_IN = process.env.STATE_IN, LOCAL_OUT = process.env.BT_OUT;
const DAYS = +process.env.BT_DAYS || 7, OUT_FILE = 'smc-backtest.json', OUT_BR = 'backtest';
const H = 3600e3, M5 = 300e3, M15 = 900e3, API = 'https://fapi.asterdex.com';
const T0 = Date.now(), log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a), sleep = ms => new Promise(z => setTimeout(z, ms));

/* ---------- private data repo (same calls as bot/run.mjs) ---------- */
async function gh(p, opt = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${p}`, {method: opt.method || 'GET',
    headers: Object.assign({Authorization: 'Bearer ' + TOKEN, Accept: opt.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'aster-desk-backtest'}, opt.body ? {'Content-Type': 'application/json'} : {}),
    body: opt.body ? JSON.stringify(opt.body) : undefined});
  if (opt.ok404 && r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} ${p.split('?')[0]}: ${(await r.text()).slice(0, 200)}`);
  return opt.raw ? r.text() : r.json();
}
async function readState() {
  if (LOCAL_IN) return JSON.parse(fs.readFileSync(LOCAL_IN, 'utf8').replace(/^﻿/, ''));
  const r = await gh('/git/ref/heads/state'); return JSON.parse(await gh(`/contents/aster-desk-state.json?ref=${r.object.sha}`, {raw: true}));
}
async function writeOut(o) {
  const txt = JSON.stringify(o);
  if (LOCAL_OUT) { fs.writeFileSync(LOCAL_OUT, txt); return 'local'; }
  const cur = await gh('/git/ref/heads/' + OUT_BR, {ok404: true});
  const blob = await gh('/git/blobs', {method: 'POST', body: {content: Buffer.from(txt).toString('base64'), encoding: 'base64'}});
  const tree = await gh('/git/trees', {method: 'POST', body: {tree: [{path: OUT_FILE, mode: '100644', type: 'blob', sha: blob.sha}]}});
  const c = await gh('/git/commits', {method: 'POST', body: {message: `SMC backtest ${DAYS}d · ${o.sum.variants.base.n} trades`, tree: tree.sha, parents: []}});
  if (cur) await gh('/git/refs/heads/' + OUT_BR, {method: 'PATCH', body: {sha: c.sha, force: true}});
  else await gh('/git/refs', {method: 'POST', body: {ref: 'refs/heads/' + OUT_BR, sha: c.sha}});
  return c.sha;
}

/* ---------- Aster REST, paced (≤ ~9 requests/s), retry on 429 / 5xx / network errors ---------- */
let slot = 0;
async function aster(p) {
  for (let a = 0; ; a++) {
    const w = slot - Date.now(); slot = Math.max(Date.now(), slot) + 110; if (w > 0) await sleep(w);
    let r; try { r = await fetch(API + p); } catch (_) { r = {ok: false, status: 0}; }
    if (r.ok) return r.json();
    if (a >= 5 || !(r.status === 0 || r.status === 429 || r.status >= 500)) throw new Error(`Aster ${r.status} ${p.split('?')[0]}`);
    await sleep(2000 * 2 ** a);
  }
}
// [openTime, open, high, low, close, quoteVol, takerBuyQuoteVol], open time in [from, to)
async function klines(s, iv, ms, from, to) {
  const out = [];
  for (let t = from; t < to;) {
    const a = await aster(`/fapi/v1/klines?symbol=${s}&interval=${iv}&startTime=${t}&limit=1500`);
    for (const b of a) if (+b[0] < to) out.push([+b[0], +b[1], +b[2], +b[3], +b[4], +b[7], +b[10]]);
    if (a.length < 1500) break; t = +a[a.length - 1][0] + ms;
  }
  return out;
}
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({length: n}, async () => { while (q.length) { const x = q.shift(); try { await fn(x); } catch (e) { log('  skip', x, e.message); } } })); }

/* ---------- the desk's own code in a sandbox (as bot/run.mjs; only the desk settings are loaded) ---------- */
export async function mkCore(deskCfg, exInfo) {
  const store = new Map(deskCfg ? [['awx_cfg', JSON.stringify(deskCfg)]] : []);
  const el = {addEventListener() {}, style: {setProperty() {}}, classList: {add() {}, remove() {}}, textContent: '', innerHTML: ''};
  const ctx = vm.createContext({console, fetch, URL, TextEncoder, TextDecoder, Date, Math, JSON, Promise, setTimeout, clearTimeout, setInterval: () => 0, navigator: {userAgent: 'node'},
    localStorage: {getItem: k => store.has(k) ? store.get(k) : null, setItem() {}, removeItem() {}}, document: {querySelector: () => null, getElementById: () => el}, addEventListener() {},
    sayFor() {}, renderPanel() {}, syViewer: () => false});
  vm.runInContext(fs.readFileSync(DIR + 'core.js', 'utf8'), ctx, {filename: 'core.js'});
  const X = c => vm.runInContext(c, ctx);
  ctx.__EX = exInfo;
  await X(`syncAggSubs = () => {}; api = async p => /exchangeInfo/.test(p) ? __EX : []; loadExInfo();`);   // S.meta (top / stock flags) as the desk reads it
  return {ctx, X};
}
// count of bars (sorted by open time) closed by T
export function nClosed(B, len, T) { let lo = 0, hi = B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (B[m][0] + len <= T) lo = m + 1; else hi = m; } return lo; }
// the 24h ticker at hour mark h, from 1h bars closed by h only
export function tkAt(B, h) {
  const n = nClosed(B, H, h); if (!n || B[n - 1][0] !== h - H) return null;
  const W = B.slice(0, n).filter(b => b[0] >= h - 24 * H); if (W.length < 20) return null;
  return {last: W[W.length - 1][4], pct: (W[W.length - 1][4] / W[0][1] - 1) * 100, qv: W.reduce((a, b) => a + b[5], 0)};
}
// tracker at hour h: the desk's own trkTop picks (top 5 per side, volume ≥ trkMinVol, move ≥ trkMinMove), kept 24 h after a coin was last in the top 5
export function trkHour(X, ctx, H1, h, trk) {
  const tk = {}; for (const s in H1) { const t = tkAt(H1[s], h); if (t) tk[s] = t; }
  ctx.__TK = tk;
  const [g5, l5] = X(`S.tk.clear(); for (const [s, t] of Object.entries(__TK)) S.tk.set(s, t); recomputeUniverse(); [trkTop('G'), trkTop('L')]`).map(a => [...a]);
  for (const [list, side] of [[g5, 'G'], [l5, 'L']]) list.forEach((s, i) => { let e = trk[s]; if (!e || e.side !== side) e = trk[s] = {side, t0: h, px0: tk[s].last, pct0: tk[s].pct}; e.lastTop = h; e.rank = i + 1; });
  for (const s in trk) { if (!g5.includes(s) && !l5.includes(s)) trk[s].rank = null; if (h - trk[s].lastTop > 24 * H) delete trk[s]; }
  return {tk, trk: structuredClone(trk)};
}
const agg = (B, t) => [t, B[0][1], Math.max(...B.map(b => b[2])), Math.min(...B.map(b => b[3])), B[B.length - 1][4], B.reduce((a, b) => a + b[5], 0), B.reduce((a, b) => a + b[6], 0)];
// what the desk would hold for a coin at T: closed bars + a forming bar built from the 5m bars closed by T. Right at a 15m / 1h
// boundary there is no forming bar yet, as in tools/smc-replay.mjs: live entries at boundary+20 s match that read, not a flat new bar
export function viewAt(C, T) {
  const n5 = nClosed(C.m5, M5, T); if (!n5) return null;
  const last = C.m5[n5 - 1][4], form = len => { const p0 = Math.floor(T / len) * len, F = []; for (let i = n5 - 1; i >= 0 && C.m5[i][0] >= p0; i--) F.unshift(C.m5[i]); return F.length ? [agg(F, p0)] : []; };
  const n15 = nClosed(C.m15, M15, T), n1 = nClosed(C.h1, H, T);
  return {last, k: C.m15.slice(Math.max(0, n15 - 95), n15).concat(form(M15)), h: C.h1.slice(Math.max(0, n1 - 71), n1).concat(form(H))};
}

/* ---------- one variant over the whole window ---------- */
async function simulate(name, st, exInfo, D, U, steps, setup, probe = new Map()) {
  const {ctx, X} = await mkCore(st.cfg, exInfo);
  ctx.__ST = {cfg: (st.sm && st.sm.cfg) || {}, adj: (st.rv && st.rv.smAdj) || {}};
  X(`SM.cfg = Object.assign({}, SM_DEF.cfg, __ST.cfg); RV.smAdj = JSON.parse(JSON.stringify(__ST.adj)); delete RV.smAdj.zone; SM.cfg.zoneLearn = 0;
     Object.assign(SM, {on: true, pos: {}, log: [], cool: {}, cash: SM.start, day: null, paused: null, eqs: []}); warm = true; S.started = 0;
     // manage one coin through one closed candle: open, adverse extreme, favourable extreme, close; fill at the exact level crossed (as bot/run.mjs)
     var __walk = (s, o, h, l, c, tEnd) => { const p = SM.pos[s]; if (!p) return; CLOCK_OVR = tEnd; const L = p.side === 'L'; let prev = o;
       for (const v of L ? [o, l, h, c] : [o, h, l, c]) { const q = SM.pos[s]; if (!q) break; const d = Math.abs(q.entry - q.stop0), dir = L ? 1 : -1;
         const lv = [q.stop, q.tp1 ? null : q.entry + dir * (q.tp1R || SM.cfg.tp1R) * d, q.target].filter(z => z != null && isFinite(z));
         const pts = lv.filter(z => (z - prev) * (z - v) <= 0 && z !== prev).sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
         for (const z of [...pts, v]) { if (!SM.pos[s]) break; PX_OVR = {[s]: z}; smManage(CLOCK_OVR, s); } prev = v; }
       PX_OVR = null; CLOCK_OVR = 0; };`);
  if (setup) X(setup);
  const trades = [], obBlocked = new Set(), seen = {};
  for (const T of steps) {
    // 1. open positions through the 5m candle that just closed
    for (const s of X('Object.keys(SM.pos)')) { const C = D[s], i = C ? nClosed(C.m5, M5, T) - 1 : -1; if (i >= 0 && C.m5[i][0] === T - M5) { const b = C.m5[i]; ctx.__B = [s, b[1], b[2], b[3], b[4], T - 1]; X('__walk(...__B)'); } }
    // 2. what the desk sees at T: the tracker from the last full hour, bars closed by T
    const u = U.get(Math.floor(T / H) * H); if (!u) continue;
    const F = {};
    for (const s of new Set([...Object.keys(u.trk), ...X('Object.keys(SM.pos)')])) {
      const v = D[s] && viewAt(D[s], T); if (!v) continue; const t24 = u.tk[s];
      F[s] = {k: v.k, h: v.h, tk: {last: v.last, pct: t24 ? (v.last / (t24.last / (1 + t24.pct / 100)) - 1) * 100 : 0, qv: t24 ? t24.qv : 0}};
    }
    ctx.__T = T; ctx.__F = F; ctx.__TRK = u.trk; ctx.__PR = probe.get(T);
    const r = X(`(() => { CLOCK_OVR = __T; S.trk = __TRK; S.kl.clear(); S.h1.clear(); S.tk.clear(); S.M.clear(); S.smC.clear(); S.alerts.length = 0;
      for (const [s, f] of Object.entries(__F)) { S.kl.set(s, {t: __T, bars: f.k}); S.h1.set(s, {t: __T, bars: f.h}); S.tk.set(s, f.tk); }
      smTick();
      const ob = ((SM.lastScan && SM.lastScan.t === __T && SM.lastScan.cands) || []).filter(c => /^order block entry: quality/.test(c.skip || '')).map(c => { const s = Object.keys(S.trk).find(k => base(k) === c.b), z = (S.smC.get(s) || {}).zone || {}; return s + '|' + c.tf + '|' + z.lo + '|' + z.hi; });
      const pr = (__PR || []).map(s => { const r = S.smC.get(s), c = ((SM.lastScan && SM.lastScan.t === __T && SM.lastScan.cands) || []).find(c => c.b === base(s));
        return [s, !S.trk[s] ? 'not tracked' : !r ? 'no candles' : r.stage + (c ? ': ' + (c.took ? 'took it' : c.skip) : '')]; });   // why it did or didn't trade where live did
      CLOCK_OVR = 0; return {L: SM.log.splice(0), ob, pr}; })()`);
    trades.push(...r.L); r.ob.forEach(k => obBlocked.add(k)); for (const [s, w] of r.pr) seen[s + '|' + T] = w;
  }
  const open = X('Object.keys(SM.pos).length');
  return {name, trades: trades.sort((a, b) => a.t0 - b.t0), open, seen, obBlocked: obBlocked.size, obMinQ: X('smRules().obMinQ') || X('Math.min(90, Math.max(SM.cfg.minQ, RV.smAdj.minQ || 0) + 10)')};
}

/* ---------- splits ---------- */
const fin = v => typeof v === 'number' && isFinite(v);
const st3 = A => { const R = A.map(x => x.R); return {n: R.length, avgR: R.length ? +(R.reduce((a, b) => a + b, 0) / R.length).toFixed(3) : null, win: R.length ? Math.round(R.filter(v => v > 0).length / R.length * 100) : null}; };
// "flow against the trade": the coin's net taker flow over the last hour (15m kline taker-buy volume, the reading every trade
// stores as cx.flow, signed with the coin's move) points the other way from the trade
export const flowAg = x => !x.cx || !fin(x.cx.flow) ? null : x.cx.flow * (x.cx.side === 'L' ? -1 : 1) * (x.side === 'L' ? 1 : -1) < 0;
const mvBand = x => x.cx && fin(x.cx.mv) && x.cx.mv >= 15 && x.cx.mv <= 40;
const split = (A, drop) => ({kept: st3(A.filter(x => !drop(x))), dropped: st3(A.filter(drop))});
const row = (x, v) => ({v, s: x.s, side: x.side, t0: x.t0, t1: x.t1, tf: x.tf, type: x.type, zk: x.zoneKind, q: x.q ? x.q.score : null, g: x.grd ? x.grd.g : null, reg: x.regime,
  R: +x.R.toFixed(3), maxR: +(x.maxR || 0).toFixed(2), stopPct: +(Math.abs(x.entry - x.stop0) / x.entry * 100).toFixed(2), why: String(x.exitWhy || '').slice(0, 40),
  mv: x.cx && fin(x.cx.mv) ? +x.cx.mv.toFixed(1) : null, flow: x.cx && fin(x.cx.flow) ? +x.cx.flow.toFixed(1) : null, fAg: flowAg(x)});

async function main() {
  if (!LOCAL_IN && (!REPO || !TOKEN)) throw new Error('DATA_REPO / DATA_TOKEN not set (or use STATE_IN + BT_OUT for a local run)');
  const st = await readState();
  const END = Math.floor(Date.now() / M5) * M5, W0 = END - DAYS * 24 * H, h0 = Math.floor(W0 / H) * H;
  const exInfo = await aster('/fapi/v1/exchangeInfo');
  const uc = await mkCore(st.cfg, exInfo), syms = uc.X('[...S.meta.keys()]');
  // 1h bars for every USDT perp: 24h tickers for the tracker (from 24 h before the window) and the 1h / 4h view (72 bars back)
  const H1 = {};
  await pool(syms, 4, async s => { H1[s] = await klines(s, '1h', H, h0 - 96 * H, END); });
  log(`${syms.length} markets, 1h bars loaded (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
  const U = new Map(), trk = {};
  for (let h = h0 - 24 * H; h <= END; h += H) { const u = trkHour(uc.X, uc.ctx, H1, h, trk); if (h >= h0) U.set(h, u); }
  const coins = [...new Set([...U.values()].flatMap(u => Object.keys(u.trk)))];
  const D = {};
  await pool(coins, 4, async s => { D[s] = {h1: H1[s], m15: await klines(s, '15m', M15, h0 - 100 * M15, END), m5: await klines(s, '5m', M5, h0 - H, END)}; });
  log(`${coins.length} coins tracked at some point; candles loaded (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
  const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  const adj = (st.rv && st.rv.smAdj) || {};
  const live = ((st.sm && st.sm.log) || []).filter(x => x.s && x.t0 && x.side && fin(x.R) && !/closed by you/.test(x.exitWhy || ''));
  const inW = live.filter(x => x.t0 > W0 && x.t0 <= END), stepOf = x => Math.floor(x.t0 / M5) * M5, probe = new Map();
  for (const x of inW) probe.set(stepOf(x), [...(probe.get(stepOf(x)) || []), x.s]);
  const V = {base: await simulate('base', st, exInfo, D, U, steps, '', probe)};
  log(`base: ${V.base.trades.length} trades (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
  V.zone = adj.zone ? await simulate('zone', st, exInfo, D, U, steps, `RV.smAdj.zone = ${JSON.stringify(adj.zone)}; SM.cfg.zoneLearn = 1;`) : null;
  V.noObQ = await simulate('noObQ', st, exInfo, D, U, steps, 'delete RV.smAdj.obQ;');
  log(`variants done (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);

  // ---- splits: backtest vs live
  const B = V.base.trades, obMin = V.base.obMinQ || 80;
  const isOB = x => x.zoneKind && x.zoneKind !== 'FVG';
  const dec = [
    {k: 'flow', lab: 'Skip when the 1h taker flow is against the trade', how: 'cx.flow: net taker flow over the last 4 × 15m klines (taker-buy quote volume), the same reading live trades store; unknown counted as kept',
      bt: split(B, x => flowAg(x) === true), live: split(live, x => flowAg(x) === true)},
    {k: 'move', lab: 'Skip coins up or down 15–40% on the day', how: 'cx.mv = |24h change| at entry', bt: split(B, mvBand), live: split(live, mvBand)},
    {k: 'obfvg', lab: 'Order blocks: kept = FVG entries, dropped = OB entries', bt: split(B, isOB), live: split(live, isOB)},
    {k: 'obQ', lab: `OB quality bar: kept = OB q ≥ ${obMin}, dropped = OB q < ${obMin} (noObQ variant)`, blocked: V.base.obBlocked,
      bt: split(V.noObQ.trades.filter(isOB), x => !(x.q && x.q.score >= obMin)), live: split(live.filter(isOB), x => !(x.q && x.q.score >= obMin))},
  ];
  // sanity: live trades inside the window that the backtest also entered (same coin and side, ±30 min)
  const pairs = inW.map(x => [x, B.find(y => y.s === x.s && y.side === x.side && Math.abs(y.t0 - x.t0) <= 30 * 60e3)]).filter(p => p[1]);
  const svl = {live: inW.length, matched: pairs.length, meanAbsDR: pairs.length ? +(pairs.reduce((a, [x, y]) => a + Math.abs(x.R - y.R), 0) / pairs.length).toFixed(3) : null, why: {}};
  for (const x of inW) if (!pairs.some(p => p[0] === x)) { const k = String(V.base.seen[x.s + '|' + stepOf(x)] || 'no read').replace(/[\d.]+/g, '#').slice(0, 70); svl.why[k] = (svl.why[k] || 0) + 1; }
  const vs = {}; for (const k in V) if (V[k]) vs[k] = Object.assign(st3(V[k].trades), {open: V[k].open});
  const sum = {t: Date.now(), from: W0, to: END, days: DAYS, coins: coins.length, runS: Math.round((Date.now() - T0) / 1e3), variants: vs, zoneW: adj.zone || null, obMinQ: obMin, decisions: dec, simVsLive: svl,
    note: 'Backtest — proposal only, never applied. Same SMC code as the cloud; 5m steps, tracker rebuilt hourly from closed 1h bars; fills at the 5m close + slippage; coins delisted since are missing.'};
  const f = s => s.n ? `n ${s.n} avg ${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R win ${s.win}%` : 'n 0';
  const lines = [`SMC backtest ${DAYS}d ${new Date(W0).toISOString().slice(0, 16)} → ${new Date(END).toISOString().slice(0, 16)} UTC · ${coins.length} coins · ${sum.runS} s`,
    ...Object.entries(vs).map(([k, s]) => `variant ${k.padEnd(5)}: ${f(s)} (open at end ${s.open}, not counted)`),
    ...dec.map(d => `${d.k.padEnd(5)}: bt kept ${f(d.bt.kept)} | dropped ${f(d.bt.dropped)} · live kept ${f(d.live.kept)} | dropped ${f(d.live.dropped)}${d.blocked != null ? ` · OB setups blocked by obQ in base: ${d.blocked}` : ''}`),
    `sim vs live: ${svl.matched}/${svl.live} live trades in the window also entered by the backtest (±30 min), mean |R diff| ${svl.meanAbsDR ?? '—'}`,
    'not matched, backtest state at the live entry: ' + Object.entries(svl.why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${k}`).join(' | ')];
  sum.lines = lines;
  const rows = [...B.map(x => row(x, 'base')), ...(V.zone ? V.zone.trades.map(x => row(x, 'zone')) : []), ...V.noObQ.trades.map(x => row(x, 'noObQ'))];
  const sha = await writeOut({v: 1, sum, trades: rows});
  console.log(lines.join('\n'));
  log(`saved ${sha === 'local' ? LOCAL_OUT : `${OUT_BR} ${sha.slice(0, 7)}`} (${rows.length} rows)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error('BACKTEST FAILED:', e.stack || e.message); process.exit(1); });

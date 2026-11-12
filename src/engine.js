'use strict';
/* ================= CONFIG ================= */
const API = 'https://fapi.asterdex.com';
const WSS = 'wss://fstream.asterdex.com/stream';
const MAX_UNI = 180;               // symbols polled for OI + flow
const AGENTS = [
  {id:'scout', key:'1', name:'GainerLoser', role:'Movers, Patterns & Unlocks', color:'#4dd2ff', blurb:'Top gainers & losers, pattern tags, all-day trend tracking, token unlock calendar'},
  {id:'ivy',   key:'2', name:'OpenInterest', role:'Open Interest Watch',     color:'#b48cff', blurb:'Sudden OI spikes and drops, and what they mean with price'},
  {id:'flo',   key:'3', name:'Flow',     role:'Money Flow & Positioning',    color:'#2ee59d', blurb:'Net taker flow, buy/sell pressure, funding crowding, whales, liquidations'},
  {id:'trader', key:'4', name:'Trader',  role:'Paper Trading Desk',          color:'#ffd166', blurb:'Trades reversal and momentum signals on a $1,000 paper account'},
  {id:'smc',   key:'6', name:'SMC Trader', role:'Smart Money Paper Desk',  color:'#ff8ad8', blurb:'Trades liquidity sweeps, structure shifts and FVG / order-block pullbacks on the top-5 movers; its own $1,000 paper account'},
  {id:'rev',   key:'5', name:'Reviewer', role:'Trade Review & Rules',        color:'#c5f05a', blurb:'Grades every trade and tunes the Trader\'s rules'},
];
const AG = Object.fromEntries(AGENTS.map(a => [a.id, a]));
const DEF = {minVol:100000, smallCapOnly:true, includeStocks:false, whaleUsd:10000, oiAlertPct:8, oiWindow:15, flowAlertUsd:40000, sound:false, watch:['ASTERUSDT'], unl:[], trkMinVol:300000, trkMinMove:8};
const UP = '#2ee59d', DN = '#ff5c7a', DIM = '#7c89a8', WARN = '#ffc94d', TXT = '#dbe4fb';

/* ================= UTILS ================= */
const $ = s => document.querySelector(s);
let CLOCK_OVR = 0; // the cloud bot sets this while replaying past candles
const now = () => CLOCK_OVR || Date.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fin = v => v != null && isFinite(v);
function fmtUsd(v, sign) {
  if (!fin(v)) return '—';
  const s = v < 0 ? '-' : (sign && v > 0 ? '+' : ''); const a = Math.abs(v); let t;
  if (a >= 1e9) t = (a / 1e9).toFixed(2) + 'B'; else if (a >= 1e6) t = (a / 1e6).toFixed(2) + 'M';
  else if (a >= 1e3) t = (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K'; else t = a.toFixed(0);
  return s + '$' + t;
}
function fmtPct(v, d = 1) { return fin(v) ? (v > 0 ? '+' : '') + v.toFixed(d) + '%' : '—'; }
function fmtPx(v) {
  if (!fin(v)) return '—'; const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(1); if (a >= 10) return v.toFixed(2); if (a >= 1) return v.toFixed(4);
  if (a >= 0.01) return v.toFixed(5); return v.toPrecision(4);
}
function fmtFund(r) { return fin(r) ? (r > 0 ? '+' : '') + (r * 100).toFixed(4) + '%' : '—'; }
function fmtRatio(r) { return fin(r) ? r.toFixed(2) + '×' : '—'; }
const tone = v => !fin(v) ? DIM : v > 0 ? UP : v < 0 ? DN : DIM;
const cls = v => !fin(v) ? 'dim' : v > 0 ? 'up' : v < 0 ? 'dn' : 'dim';
function ago(t) { const s = Math.max(0, Math.round((now() - t) / 1000)); if (s < 60) return s + 's'; if (s < 3600) return Math.round(s / 60) + 'm'; return (s / 3600).toFixed(1) + 'h'; }
function hhmm(t) { const d = new Date(t); return d.toTimeString().slice(0, 5); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
const CFG = Object.assign({}, DEF, LS.get('awx_cfg', {}));
function saveCfg() { LS.set('awx_cfg', CFG); }

/* ================= STATE ================= */
const S = {
  meta: new Map(), tk: new Map(), fund: new Map(), oi: new Map(), kl: new Map(), M: new Map(),
  whales: [], liqs: [], alerts: [], eligible: [], gainers: [], losers: [], universe: [], prio: new Set(),
  focus: null, focusPinned: false, wsOk: false, wsLast: 0, wsMark: 0, restOk: null, apiErr: null, reqs: 0,
  started: now(), bootLog: [], top5: new Set(), lastReq: 0,
  h1: new Map(), fint: new Map(), trk: {}, tagC: new Map(), trC: new Map(), ticker: '',
};
function base(s) { const m = S.meta.get(s); return m ? m.base : String(s).replace(/USDT$/, ''); }
function boot(msg) { S.bootLog.push(msg); const el = $('#boot'); if (el) { el.textContent = S.bootLog.slice(-6).join('\n'); } }

/* ================= REST ================= */
async function api(path) {
  // Aster rejects cross-site Referer headers; a no-referrer fetch is accepted (CORS: *)
  const r = await fetch(API + path, {referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store'});
  S.reqs++; S.lastReq = now();
  if (!r.ok) throw new Error(r.status + ' ' + path.split('?')[0]);
  return r.json();
}
async function loadExInfo() {
  const ex = await api('/fapi/v1/exchangeInfo');
  const n0 = S.meta.size;
  for (const s of ex.symbols) {
    if (s.status !== 'TRADING' || s.contractType !== 'PERPETUAL' || s.quoteAsset !== 'USDT') continue;
    const sub = s.underlyingSubType || [];
    S.meta.set(s.symbol, {base: s.baseAsset, stock: s.symbolType === 1 || sub.includes('STOCK'), top: sub.includes('Top'), tags: sub, listed: s.onboardDate});
  }
  if (!n0) boot(`✓ ${S.meta.size} USDT perpetual markets listed`);
  try { const fi = await api('/fapi/v1/fundingInfo'); for (const x of fi) S.fint.set(x.symbol, +x.fundingIntervalHours || 8); } catch (_) {}
}
function upTicker(s, last, pct, open, high, low, qv, n) {
  let o = S.tk.get(s); if (!o) { o = {}; S.tk.set(s, o); }
  o.last = last; o.pct = pct; o.open = open; o.high = high; o.low = low; o.qv = qv; o.n = n; o.t = now();
}
async function loadTickers() {
  const arr = await api('/fapi/v1/ticker/24hr');
  const first = !S.tk.size;
  for (const t of arr) if (S.meta.has(t.symbol)) upTicker(t.symbol, +t.lastPrice, +t.priceChangePercent, +t.openPrice, +t.highPrice, +t.lowPrice, +t.quoteVolume, +t.count);
  recomputeUniverse();
  if (first) boot(`✓ 24h tickers: ${S.eligible.length} coins pass your filters`);
}
async function loadFunding() {
  const arr = await api('/fapi/v1/premiumIndex');
  const first = !S.fund.size;
  for (const p of arr) if (S.meta.has(p.symbol)) {
    const f = S.fund.get(p.symbol) || {}; f.r = +p.lastFundingRate; f.mark = +p.markPrice; f.next = +p.nextFundingTime; S.fund.set(p.symbol, f);
  }
  if (first) boot('✓ funding rates & mark prices');
}
async function loadOI(s) {
  const r = await api('/fapi/v1/openInterest?symbol=' + s);
  const f = S.fund.get(s) || {}, t = S.tk.get(s) || {};
  addOI(s, now(), +r.openInterest, f.mark || t.last || 0);
  checkOIAlert(s);
}
async function loadKl(s) {
  const a = await api('/fapi/v1/klines?symbol=' + s + '&interval=15m&limit=96');
  // [openTime, open, high, low, close, quoteVol, takerBuyQuoteVol]
  S.kl.set(s, {t: now(), bars: a.map(b => [+b[0], +b[1], +b[2], +b[3], +b[4], +b[7], +b[10]])});
  checkFlowAlert(s);
}

async function loadH1(s) {
  const a = await api('/fapi/v1/klines?symbol=' + s + '&interval=1h&limit=72');
  S.h1.set(s, {t: now(), bars: a.map(b => [+b[0], +b[1], +b[2], +b[3], +b[4], +b[7], +b[10]])});
}
function h1set() { return new Set([...S.gainers.slice(0, 10), ...S.losers.slice(0, 10), ...Object.keys(S.trk || {}).filter(x => S.meta.has(x)), ...(S.focus ? [S.focus] : [])]); }

/* ================= OI HISTORY ================= */
function addOI(s, t, oi, px) {
  let a = S.oi.get(s); if (!a) { a = []; S.oi.set(s, a); }
  const L = a[a.length - 1];
  if (L && t - L[0] < 25e3) { L[0] = t; L[1] = oi; L[2] = px; } else a.push([t, oi, px]);
}
function oiAt(s, mins) {
  const a = S.oi.get(s); if (!a || a.length < 2) return null;
  const cur = a[a.length - 1], target = cur[0] - mins * 60e3;
  if (a[0][0] > target + mins * 60e3 * 0.25) return null;    // not enough history yet
  let ref = a[0];
  for (let i = a.length - 1; i >= 0; i--) if (a[i][0] <= target) { ref = a[i]; break; }
  if (!ref[1]) return null;
  return {pct: (cur[1] - ref[1]) / ref[1] * 100, px: ref[2] ? (cur[2] - ref[2]) / ref[2] * 100 : null, mins: (cur[0] - ref[0]) / 60e3};
}
function pruneOI() {
  const t = now();
  for (const [s, a] of S.oi) {
    const out = []; let kept = 0;
    for (const p of a) {
      const age = t - p[0]; if (age > 26 * 3600e3) continue;
      if (age > 2 * 3600e3 && p[0] - kept < 5 * 60e3) continue;
      out.push(p); kept = p[0];
    }
    if (out.length) S.oi.set(s, out); else S.oi.delete(s);
  }
}
function saveOI() {
  const d = {};
  for (const [s, a] of S.oi) d[s] = a.map(p => [Math.round(p[0] / 1000), +p[1].toPrecision(8), +(+p[2]).toPrecision(6)]);
  if (!LS.set('awx_oi', {v: 1, d})) { pruneOI(); }
}
function restoreOI() {
  const o = LS.get('awx_oi', null); if (!o || !o.d) return 0;
  const t = now(); let n = 0;
  for (const s in o.d) {
    const a = o.d[s].map(p => [p[0] * 1000, p[1], p[2]]).filter(p => t - p[0] < 26 * 3600e3);
    if (a.length) { S.oi.set(s, a); n++; }
  }
  return n;
}
function oiHistoryMins() {
  let oldest = Infinity; for (const a of S.oi.values()) if (a.length) oldest = Math.min(oldest, a[0][0]);
  return oldest === Infinity ? 0 : (now() - oldest) / 60e3;
}

/* ================= UNIVERSE ================= */
function eligible(s) {
  const m = S.meta.get(s), t = S.tk.get(s); if (!m || !t) return false;
  if (!CFG.includeStocks && m.stock) return false;
  if (CFG.smallCapOnly && m.top) return false;
  return t.qv >= CFG.minVol && fin(t.pct);
}
// the movers worth following: the top 5 among coins liquid enough for the traders and that have really moved
// (GainerLoser → Settings: "Track movers with volume ≥" and "…that moved at least")
function trkTop(side) {
  const mv = CFG.trkMinMove || 0, vol = CFG.trkMinVol || 0;
  return (side === 'G' ? S.gainers : S.losers).filter(s => { const t = S.tk.get(s); return t && t.qv >= vol && (side === 'G' ? t.pct >= mv : t.pct <= -mv); }).slice(0, 5);
}
function recomputeUniverse() {
  const el = [...S.tk.keys()].filter(eligible);
  S.eligible = el;
  const g = [...el].sort((a, b) => S.tk.get(b).pct - S.tk.get(a).pct);
  S.gainers = g.slice(0, 30); S.losers = g.slice(-30).reverse();
  const prio = new Set([...S.gainers.slice(0, 12), ...S.losers.slice(0, 12), ...Object.keys(S.trk || {}).filter(x => S.meta.has(x)), ...CFG.watch.filter(x => S.meta.has(x))]);
  if (S.focus) prio.add(S.focus);
  S.prio = prio;
  const uni = new Set(prio);
  for (const s of [...el].sort((a, b) => S.tk.get(b).qv - S.tk.get(a).qv)) { if (uni.size >= MAX_UNI) break; uni.add(s); }
  S.universe = [...uni];
  if (!S.focus && S.gainers.length) S.focus = CFG.watch.find(x => S.meta.has(x) && S.gainers.includes(x)) || S.gainers[0];
  syncAggSubs();
}

/* ================= SCHEDULER (rate-limited, ~4 req/s max) ================= */
const G = {exinfo: 0, tickers: 0, funding: 0};
const nextRun = new Map();
let inflight = 0, pauseUntil = 0;
const IV = {oi: [30e3, 120e3], kl: [60e3, 300e3]};
function pickJob() {
  const t = now(); if (t < pauseUntil) return null;
  if (t >= G.exinfo) return {k: 'exinfo'};
  if (!S.meta.size) return null;
  if (t >= G.tickers) return {k: 'tickers'};
  if (t >= G.funding) return {k: 'funding'};
  let best = null, bl = -1;
  for (const s of S.universe) for (const k of ['oi', 'kl']) {
    const key = k + ':' + s; let late = t - (nextRun.get(key) || 0); if (late < 0) continue;
    if (S.prio.has(s)) late += 6e5; if (s === S.focus) late += 6e6;
    if (late > bl) { bl = late; best = {k, s, key}; }
  }
  for (const s of h1set()) {
    const key = 'h1:' + s; let late = t - (nextRun.get(key) || 0); if (late < 0) continue; late += S.h1.has(s) ? 3e5 : 7e5;
    if (late > bl) { bl = late; best = {k: 'h1', s, key}; }
  }
  return best;
}
async function run(j) {
  inflight++; const t = now();
  try {
    if (j.k === 'exinfo') { G.exinfo = t + 30 * 60e3; await loadExInfo(); }
    else if (j.k === 'tickers') { G.tickers = t + (S.wsOk ? 60e3 : 15e3); await loadTickers(); }
    else if (j.k === 'funding') { G.funding = t + (now() - S.wsMark < 10e3 ? 180e3 : 30e3); await loadFunding(); }
    else if (j.k === 'h1') { nextRun.set(j.key, t + 5 * 60e3); await loadH1(j.s); }
    else { nextRun.set(j.key, t + IV[j.k][S.prio.has(j.s) ? 0 : 1]); if (j.k === 'oi') await loadOI(j.s); else await loadKl(j.s); }
    S.apiErr = null; S.restOk = true;
  } catch (e) {
    S.apiErr = e.message || String(e);
    if (/^(429|418)/.test(S.apiErr)) pauseUntil = now() + 30e3;
    if (e instanceof TypeError) { S.restOk = false; if (!S.meta.size) boot('✗ Cannot reach Aster API (' + S.apiErr + '). Open this file directly in Chrome.'); }
    if (j.k === 'exinfo') G.exinfo = t + 8e3; else if (j.k === 'tickers') G.tickers = t + 10e3;
    else if (j.k === 'funding') G.funding = t + 15e3; else nextRun.set(j.key, t + 20e3);
  } finally { inflight--; }
}
function dispatch() { if (inflight < 3) { const j = pickJob(); if (j) run(j); } }

/* ================= WEBSOCKET ================= */
let ws = null, wsSubs = new Set(), wsId = 1, wsBack = 1000;
function connectWS() {
  try { ws = new WebSocket(WSS + '?streams=!ticker@arr/!markPrice@arr@1s/!forceOrder@arr'); }
  catch (e) { setTimeout(connectWS, 5000); return; }
  ws.onopen = () => { S.wsOk = true; wsBack = 1000; wsSubs.clear(); syncAggSubs(); boot('✓ live stream connected (tickers, funding, liquidations)'); };
  ws.onmessage = e => {
    let j; try { j = JSON.parse(e.data); } catch (_) { return; }
    if (!j.stream) return; const d = j.data; S.wsLast = now();
    if (j.stream === '!ticker@arr') { for (const t of d) if (S.meta.has(t.s)) upTicker(t.s, +t.c, +t.P, +t.o, +t.h, +t.l, +t.q, +t.n); }
    else if (j.stream.startsWith('!markPrice')) {
      S.wsMark = now();
      for (const p of d) { if (!S.meta.has(p.s)) continue; const f = S.fund.get(p.s) || {}; f.mark = +p.p; f.r = +p.r; f.next = +p.T; S.fund.set(p.s, f); }
    }
    else if (j.stream === '!forceOrder@arr') { for (const x of (Array.isArray(d) ? d : [d])) if (x && x.o) onLiq(x.o); }
    else if (j.stream.endsWith('@aggTrade')) onAgg(d);
  };
  ws.onclose = () => { S.wsOk = false; wsSubs.clear(); setTimeout(connectWS, wsBack); wsBack = Math.min(wsBack * 2, 30000); };
  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}
function syncAggSubs() {
  if (!ws || ws.readyState !== 1) return;
  const want = new Set([...new Set([...(S.focus ? [S.focus] : []), ...S.prio])].slice(0, 40).map(s => s.toLowerCase() + '@aggTrade'));
  const add = [...want].filter(x => !wsSubs.has(x)), rem = [...wsSubs].filter(x => !want.has(x));
  try {
    if (rem.length) { ws.send(JSON.stringify({method: 'UNSUBSCRIBE', params: rem, id: wsId++})); rem.forEach(x => wsSubs.delete(x)); }
    if (add.length) { ws.send(JSON.stringify({method: 'SUBSCRIBE', params: add, id: wsId++})); add.forEach(x => wsSubs.add(x)); }
  } catch (_) {}
}
function onAgg(d) {
  const usd = +d.p * +d.q; if (!(usd >= CFG.whaleUsd)) return;
  const side = d.m ? 'SELL' : 'BUY';           // m = buyer is maker → aggressive seller
  S.whales.unshift({t: +d.T || now(), s: d.s, side, usd, px: +d.p}); if (S.whales.length > 200) S.whales.pop();
  if (usd >= CFG.whaleUsd * 2) raise('flo', d.s, 'whale' + side, `${base(d.s)} whale market ${side === 'BUY' ? 'buy' : 'sell'} ${fmtUsd(usd)} @ ${fmtPx(+d.p)}`, side === 'BUY' ? 1 : -1, 180e3);
}
function onLiq(o) {
  const px = +o.ap || +o.p, q = +o.z || +o.q, usd = px * q; if (!fin(usd) || !S.meta.has(o.s)) return;
  const longLiq = o.S === 'SELL';                 // a forced SELL closes a long
  S.liqs.unshift({t: +o.T || now(), s: o.s, side: longLiq ? 'LONG' : 'SHORT', usd, px}); if (S.liqs.length > 200) S.liqs.pop();
  if (usd >= 5000) raise('flo', o.s, 'liq', `${base(o.s)} ${longLiq ? 'longs' : 'shorts'} liquidated: ${fmtUsd(usd)} @ ${fmtPx(px)}`, longLiq ? -1 : 1, 120e3);
}

/* ================= METRICS ================= */
function metrics(s) {
  const t = S.tk.get(s) || {}, f = S.fund.get(s) || {}, k = S.kl.get(s), a = S.oi.get(s);
  const m = {s, b: base(s), last: t.last, pct24: t.pct, qv: t.qv, high: t.high, low: t.low, fund: f.r, next: f.next, mark: f.mark};
  if (t.high > t.low) m.rangePos = (t.last - t.low) / (t.high - t.low);
  if (a && a.length) {
    const L = a[a.length - 1]; m.oi = L[1]; m.oiUsd = L[1] * (f.mark || t.last || L[2]); m.oiT = L[0];
    for (const w of [5, 15, 60, 240]) { const d = oiAt(s, w); m['oi' + w] = d ? d.pct : null; m['oipx' + w] = d ? d.px : null; }
  }
  if (k && k.bars.length >= 5) {
    const B = k.bars, n = B.length, live = t.last || B[n - 1][4];
    const ref = i => B[Math.max(0, n - 1 - i)][4];
    m.pct1h = (live / ref(4) - 1) * 100; m.pct4h = n > 16 ? (live / ref(16) - 1) * 100 : null;
    const sum = nb => { let q = 0, tb = 0; for (let i = Math.max(0, n - nb); i < n; i++) { q += B[i][5]; tb += B[i][6]; } return {q, net: 2 * tb - q, ratio: q - tb > 0 ? tb / (q - tb) : null}; };
    const m15 = sum(1), h1 = sum(4), h4 = sum(16), d1 = sum(96);
    m.net15 = m15.net; m.net1h = h1.net; m.net4h = h4.net; m.net24 = d1.net;
    m.ratio1h = h1.ratio; m.ratio4h = h4.ratio; m.vol1h = h1.q; m.vol15 = m15.q; m.klT = k.t;
  }
  return m;
}
const mget = s => S.M.get(s) || metrics(s);
function regime(m) {
  const w = fin(m.oi60) ? 60 : fin(m.oi15) ? 15 : fin(m.oi5) ? 5 : null;
  if (w == null) return null;
  const oi = m['oi' + w], px = m['oipx' + w]; if (!fin(px)) return null;
  const T = w >= 60 ? 1.5 : 1.0, wl = w >= 60 ? '1h' : w + 'm';
  const base = {w, wl, oi, px};
  if (Math.abs(oi) < T) return Object.assign(base, {k: 'flat', label: 'OI flat', tone: DIM, desc: 'Positioning barely changed — the move isn\'t being driven by new leverage.'});
  if (px >= 0 && oi > 0) return Object.assign(base, {k: 'upup', label: 'New longs entering', tone: UP, desc: 'Price ↑ with OI ↑: fresh leveraged longs. The trend has fuel, but it can unwind fast if funding gets hot.'});
  if (px >= 0 && oi < 0) return Object.assign(base, {k: 'updn', label: 'Short covering', tone: WARN, desc: 'Price ↑ while OI ↓: shorts closing out. Rallies like this often stall once the covering is done.'});
  if (px < 0 && oi > 0) return Object.assign(base, {k: 'dnup', label: 'New shorts pressing', tone: DN, desc: 'Price ↓ with OI ↑: fresh shorts opening. Downtrend has fuel; a reversal here can squeeze hard.'});
  return Object.assign(base, {k: 'dndn', label: 'Longs exiting', tone: WARN, desc: 'Price ↓ with OI ↓: longs closing or being liquidated. Selling can exhaust once the flush is over.'});
}
const lastAlert = new Map();
let onAlert = () => {};
function raise(agent, s, key, text, dir, cool, big) {
  const id = agent + ':' + s + ':' + key, t = now();
  if ((lastAlert.get(id) || 0) > t - cool) return;
  lastAlert.set(id, t);
  const a = {t, agent, s, text, dir, big: !!big};
  S.alerts.unshift(a); if (S.alerts.length > 250) S.alerts.pop();
  onAlert(a);
}
function watched(s) { return S.prio.has(s) || S.eligible.includes(s); }
function checkOIAlert(s) {
  if (!watched(s)) return;
  const d = oiAt(s, CFG.oiWindow); if (!d) return;
  const t = S.tk.get(s) || {}, a = S.oi.get(s), L = a[a.length - 1], usd = L[1] * (t.last || L[2]);
  if (usd < 50e3 || Math.abs(d.pct) < CFG.oiAlertPct) return;
  const rg = regime(Object.assign(metrics(s), {}));
  raise('ivy', s, 'oi' + Math.sign(d.pct), `${base(s)} OI ${fmtPct(d.pct)} in ${CFG.oiWindow}m (price ${fmtPct(d.px)})${rg ? ' — ' + rg.label.toLowerCase() : ''}`, Math.sign(d.pct), 20 * 60e3);
}
function checkFlowAlert(s) {
  if (!watched(s)) return;
  const k = S.kl.get(s); if (!k || !k.bars.length) return;
  const b = k.bars[k.bars.length - 1], net = 2 * b[6] - b[5];
  if (Math.abs(net) >= CFG.flowAlertUsd && Math.abs(net) / b[5] >= 0.3)
    raise('flo', s, 'flow' + b[0] + Math.sign(net), `${base(s)} heavy ${net > 0 ? 'buying' : 'selling'}: ${fmtUsd(net, 1)} net taker flow this 15m`, Math.sign(net), 15 * 60e3);
}
let warm = false;
function periodicChecks() {
  const t = now(); if (t - S.started > 90e3) warm = true;
  // GainerLoser: new entries into top-5 movers
  const top = new Set([...trkTop('G'), ...trkTop('L')]);
  S.top5 = top;
  // Flow: funding extremes & aggressive taker imbalance
  for (const s of S.eligible) {
    const m = S.M.get(s); if (!m) continue;
    if (fin(m.fund) && Math.abs(m.fund) >= 0.001)
      raise('flo', s, 'fund' + Math.sign(m.fund), `${m.b} funding ${fmtFund(m.fund)} — ${m.fund > 0 ? 'longs crowded, paying shorts' : 'shorts crowded, squeeze fuel'}`, m.fund > 0 ? -1 : 1, 2 * 3600e3);
    if (warm && fin(m.ratio1h) && m.vol1h >= 25e3 && (m.ratio1h >= 2.2 || m.ratio1h <= 0.45))
      raise('flo', s, 'ratio' + (m.ratio1h > 1 ? 1 : -1), `${m.b} taker ${m.ratio1h > 1 ? 'buyers' : 'sellers'} ${m.ratio1h > 1 ? m.ratio1h.toFixed(1) : (1 / m.ratio1h).toFixed(1)}× the other side last hour`, m.ratio1h > 1 ? 1 : -1, 3600e3);
  }
  // GainerLoser: big token unlocks on the coins that matter (checked once a minute)
  if (t - (S.unlT || 0) > 60e3) { S.unlT = t; unlCheck(); }
}
function computeAll() {
  const set = new Set([...S.eligible, ...S.universe]);
  const M = new Map(); for (const s of set) M.set(s, metrics(s)); S.M = M;
}
function setFocus(s, pinned) {
  if (!S.meta.has(s)) return false;
  S.focus = s; if (pinned) S.focusPinned = true;
  S.prio.add(s); nextRun.set('oi:' + s, 0); nextRun.set('kl:' + s, 0); syncAggSubs();
  return true;
}

/* ================= START ENGINE ================= */
// Chrome throttles timers in background tabs to ~1/min; a Worker's clock keeps running, so the desk keeps tracking when hidden
function startTicker(fast, slow) {
  try {
    const src = 'let a=0;setInterval(function(){postMessage(0);if(++a%4===0)postMessage(1)},250)';
    const w = new Worker(URL.createObjectURL(new Blob([src], {type: 'text/javascript'})));
    let alive = false; w.onmessage = e => { alive = true; e.data === 0 ? fast() : slow(); };
    w.onerror = () => { if (!alive) fallback(); };
    S.ticker = 'worker'; S._w = w;
    setTimeout(() => { if (!alive) fallback(); }, 3000);
    return;
  } catch (e) {}
  fallback();
  function fallback() { if (S.ticker === 'timers') return; S.ticker = 'timers'; try { S._w && S._w.terminate(); } catch (_) {} setInterval(fast, 250); setInterval(slow, 1000); }
}
function startEngine() {
  const n = restoreOI();
  boot(n ? `✓ restored OI history for ${n} coins (${Math.round(oiHistoryMins())} min)` : '… no saved OI history — the OpenInterest agent starts recording now');
  boot('… connecting to fapi.asterdex.com');
  connectWS();
  let tick = 0;
  startTicker(dispatch, () => {
    tick++;
    if (S.tk.size) { computeAll(); if (tick % 10 === 0) recomputeUniverse(); if (tick % 5 === 0) periodicChecks(); if (tick % 15 === 3) trkUpdate(); if (tick % 5 === 1) ptTick(); }
    if (tick % 5 === 3 && typeof syTick === 'function') syTick();
    if (tick % 120 === 0) saveOI();
    if (tick % 300 === 0) pruneOI();
  });
  addEventListener('beforeunload', saveOI);
}

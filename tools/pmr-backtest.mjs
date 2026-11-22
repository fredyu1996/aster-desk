// GMS PMR v1.4 backtest (report only): BTCUSDT + ETHUSDT, 1h patterns → 15m POI → 5m entry, fills and exits on 1m bars.
// Costs per side: fee 0.04% + half spread 0.01%; slippage 0.02% on stop / time exits; funding from Aster's history while held.
// One setup per coin at a time (a pattern that confirms while another setup is live is counted as BUSY).
// Also checks itself for look-ahead: every setup that reached an order (and a sample of the rest) is re-run on series cut at
// its decision times; the pattern, POI and order must come out identical.
// Run: node tools/pmr-backtest.mjs   env: PMR_DAYS (365), PMR_END (ms, default: last full hour), PMR_COINS (BTCUSDT,ETHUSDT),
//      PMR_CACHE (/tmp/pmr-cache), PMR_OUT (/tmp/pmr-backtest.json)
import fs from 'node:fs';
import {aster, klines} from '../bot/backtest.mjs';
import {M1, M5, M15, H1, H4, P, mkSeries, mk4h, detect1h, runSetup, simExit, realR, contract} from '../bot/pmr.mjs';

const DAY = 864e5, DAYS = +process.env.PMR_DAYS || 365, END = +process.env.PMR_END || Math.floor(Date.now() / H1) * H1, FROM = END - DAYS * DAY;
const COINS = (process.env.PMR_COINS || 'BTCUSDT,ETHUSDT').split(','), CACHE = process.env.PMR_CACHE || '/tmp/pmr-cache', OUT = process.env.PMR_OUT || '/tmp/pmr-backtest.json';
const SPLIT = FROM + (END - FROM) * 2 / 3;
if (process.env.PMR_SET) for (const kv of process.env.PMR_SET.split(',')) { const [k, v] = kv.split('='); P[k] = +v; }   // e.g. PMR_SET=oppUnswept=0   // first 8 months / last 4, as the year report
fs.mkdirSync(CACHE, {recursive: true});
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function cached(key, fn) { const f = `${CACHE}/${key}.json`; if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); const x = await fn(); fs.writeFileSync(f, JSON.stringify(x)); return x; }
const kl = (s, iv, ms, a, b) => cached(`${s}-${iv}-${a}-${b}`, () => klines(s, iv, ms, a, b));
async function funding(s, a, b) {
  return cached(`${s}-funding-${a}-${b}`, async () => { const out = []; for (let t = a; t < b;) { const r = await aster(`/fapi/v1/fundingRate?symbol=${s}&startTime=${t}&endTime=${b}&limit=1000`); for (const x of r) out.push([+x.fundingTime, +x.fundingRate]); if (r.length < 1000) break; t = +r[r.length - 1].fundingTime + 1; } return out; });
}
// 1m bars by UTC day, fetched when a setup needs them
const m1Days = new Map();
async function m1Day(s, d) { const k = s + d; if (!m1Days.has(k)) m1Days.set(k, await kl(s, '1m', M1, d, d + DAY)); return m1Days.get(k); }
const mkM1 = s => async (a, b) => { const out = []; for (let d = Math.floor(a / DAY) * DAY; d < b; d += DAY) for (const x of await m1Day(s, d)) if (x[0] >= a && x[0] < b) out.push(x); return out; };

const st = a => { if (!a.length) return {n: 0}; let eq = 0, pk = 0, dd = 0; for (const x of a) { eq += x.R; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  return {n: a.length, win: Math.round(100 * a.filter(x => x.R > 0).length / a.length), avgR: +(a.reduce((s, x) => s + x.R, 0) / a.length).toFixed(3), totR: +eq.toFixed(2), maxDD: +dd.toFixed(2)}; };
const by = (a, f) => { const o = {}; for (const x of a) (o[f(x)] ||= []).push(x); for (const k in o) o[k] = st(o[k]); return o; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function runCoin(s) {
  const h1 = await kl(s, '1h', H1, FROM - 30 * DAY, END), m15 = await kl(s, '15m', M15, FROM - 3 * DAY, END), m5 = await kl(s, '5m', M5, FROM - 2 * DAY, END);
  const fund = await funding(s, FROM - DAY, END);
  log(s, `bars 1h ${h1.length} · 15m ${m15.length} · 5m ${m5.length} · funding ${fund.length}`);
  const mk = (B1, B15, B5) => ({S1: mkSeries(B1, H1, P.piv1h), S15: mkSeries(B15, M15, P.piv15), S5: mkSeries(B5, M5, P.piv5), S4: mkSeries(mk4h(B1), H4, P.piv4h)});
  const D = mk(h1, m15, m5), getM1 = mkM1(s), setups = [], waits = {}, busy = [];
  let busyUntil = 0;
  for (let j = 0; j < h1.length; j++) {
    const T = h1[j][0] + H1; if (T < FROM || T > END - 26 * H1) continue;
    const {ev, waits: w} = detect1h(D.S1, T, s, D.S4);
    for (const x of w) if (x.type) waits[x.reason] = (waits[x.reason] || 0) + 1;
    if (!ev) continue;
    if (T < busyUntil) { busy.push(ev.pattern_id); continue; }
    const R = await runSetup(ev, D, getM1);
    if (R.status === 'FILLED') {
      const o = R.order, m1 = await getM1(o.fill_at, o.fill_at + (P.holdH + 1) * H1), fi = m1.findIndex(b => b[0] === o.fill_at);
      const ex = simExit(m1, fi, ev.dir, o.entry, o.stop, o.target, o.fill_at);
      if (ex) { R.trade = {dir: ev.dir, entry: o.entry, stop: o.stop, target: o.target, fill_at: o.fill_at, exit: ex}; Object.assign(R.trade, realR(R.trade, fund)); R.end_at = ex.t; }
      else R.end_at = END;
    }
    busyUntil = R.end_at || T;
    setups.push(R);
  }
  // timestamp audit + look-ahead replays on cut series
  const audit = {checked: 0, eventSame: 0, orderSame: 0, order: 0, bad: []};
  const orders = setups.filter(R => R.order), sample = setups.filter(R => !R.order).filter((_, i) => i % 15 === 0);
  for (const R of [...orders, ...sample]) {
    const ev = R.ev, T0 = ev.confirmed_at; audit.checked++;
    const cut = t => mk(h1.filter(b => b[0] + H1 <= t), m15.filter(b => b[0] + M15 <= t), m5.filter(b => b[0] + M5 <= t));
    const Dc = cut(T0), e2 = detect1h(Dc.S1, T0, s, Dc.S4).ev;
    if (same(e2, ev)) audit.eventSame++; else audit.bad.push(['event', ev.pattern_id]);
    const p = R.parent; if (p && !(p.known_at <= Math.max(T0, R.log.find(x => x.code === 'POI_FROZEN').t))) audit.bad.push(['poi known after freeze', ev.pattern_id]);
    if (R.order) {
      audit.order++; const o = R.order, D2 = cut(o.active_after), R2 = await runSetup(ev, D2, getM1, o.active_after);
      const k = x => x && {e: x.entry, s: x.stop, t: x.target, a: x.active_after, g: x.grade, f: x.fvg && x.fvg.c3_closed_at, m: x.mss_confirmed_at, r: x.first_retest_at};
      if (same(k(R2.order), k(o)) && same(R2.parent && [R2.parent.lo, R2.parent.hi, R2.parent.known_at], [p.lo, p.hi, p.known_at])) audit.orderSame++; else audit.bad.push(['order', ev.pattern_id]);
      const tl = [T0, o.first_retest_at, o.mss_confirmed_at, o.active_after];
      if (!(o.first_retest_at > T0 && o.first_retest_at >= p.known_at && o.fvg.c3_closed_at > o.first_retest_at && o.active_after >= o.fvg.c3_closed_at && o.active_after >= o.mss_confirmed_at)) audit.bad.push(['order times', ev.pattern_id, tl]);
      if (o.fill_at !== undefined && !(o.fill_at >= o.active_after && o.fill_at < o.expires)) audit.bad.push(['fill before signal / after expiry', ev.pattern_id]);
      if (R.trade && !(R.trade.exit.t > o.fill_at)) audit.bad.push(['exit before fill', ev.pattern_id]);
    }
  }
  return {s, setups, waits, busy, audit};
}

const res = [];
for (const s of COINS) res.push(await runCoin(s));
const all = res.flatMap(r => r.setups), trades = all.filter(R => R.trade).map(R => Object.assign({s: R.ev.sym, type: R.ev.type, sub: R.ev.sub, dir: R.ev.dir, group: R.ev.group, grade: R.order.grade, t0: R.ev.confirmed_at,
  tgtWhy: R.order.tgtWhy, net_rr: R.order.net_rr, poi: R.parent.type}, R.trade)).sort((a, b) => a.fill_at - b.fill_at);
const funnel = {}; for (const R of all) funnel[R.status] = (funnel[R.status] || 0) + 1;
const patt = {}; for (const R of all) { const k = R.ev.type + ':' + R.ev.dir; patt[k] = (patt[k] || 0) + 1; }
const poiSkips = {}; for (const R of all) for (const l of R.log) if (/^SKIP_|REJECT/.test(l.code)) poiSkips[l.code] = (poiSkips[l.code] || 0) + 1;
const sum = {
  t: Date.now(), from: FROM, to: END, split: SPLIT, days: DAYS, coins: COINS, params: P,
  patterns: all.length, busy: res.reduce((a, r) => a + r.busy.length, 0), byPattern: patt, funnel, skips: poiSkips,
  waits: res.reduce((o, r) => { for (const k in r.waits) o[k] = (o[k] || 0) + r.waits[k]; return o; }, {}),
  all: st(trades), a: st(trades.filter(x => x.fill_at < SPLIT)), b: st(trades.filter(x => x.fill_at >= SPLIT)),
  coin: by(trades, x => x.s), type: by(trades, x => x.type), dir: by(trades, x => x.dir), group: by(trades, x => x.group), grade: by(trades, x => x.grade),
  exit: by(trades, x => x.exit.why), tgt: by(trades, x => x.tgtWhy), poi: by(trades, x => x.poi),
  fundR: +trades.reduce((a, x) => a + x.fundR, 0).toFixed(2),
  audit: res.map(r => Object.assign({s: r.s}, r.audit, {bad: r.audit.bad.slice(0, 10), nBad: r.audit.bad.length})),
};
fs.writeFileSync(OUT, JSON.stringify({sum, trades, setups: all.map(R => Object.assign(contract(R), {log: R.log.map(l => Object.assign({}, l, {t: new Date(l.t).toISOString()}))}))}, null, 1));
const f = x => x && x.n ? `n ${x.n} · win ${x.win}% · avg ${x.avgR >= 0 ? '+' : ''}${x.avgR}R · total ${x.totR >= 0 ? '+' : ''}${x.totR}R · maxDD ${x.maxDD}R` : 'n 0';
console.log(`\nPMR v1.4 backtest ${new Date(FROM).toISOString().slice(0, 10)} → ${new Date(END).toISOString().slice(0, 16)} · ${COINS.join(', ')}`);
console.log('patterns confirmed', sum.patterns, '(+ busy', sum.busy + ')', JSON.stringify(patt));
console.log('funnel', JSON.stringify(funnel));
console.log('skips / rejects (log codes)', JSON.stringify(poiSkips));
console.log('1h near misses', JSON.stringify(sum.waits));
console.log('ALL   ', f(sum.all)); console.log('half 1', f(sum.a)); console.log('half 2', f(sum.b));
for (const k of ['coin', 'type', 'dir', 'group', 'grade', 'exit', 'tgt', 'poi']) for (const [g, x] of Object.entries(sum[k])) console.log(k.padEnd(5), g.padEnd(22), f(x));
console.log('funding total', sum.fundR, 'R');
for (const a of sum.audit) console.log('audit', a.s, `replayed ${a.checked} · event identical ${a.eventSame}/${a.checked} · order identical ${a.orderSame}/${a.order} · problems ${a.nBad}`, a.nBad ? JSON.stringify(a.bad) : '');
console.log('written', OUT);

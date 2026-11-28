// Does the ICT NY-morning idea add anything to the SMC strategies we run? REPORT ONLY, changes nothing.
// Splits SMC trades (year backtest base/raw on BTC/ETH + live SM / SB / SE / SP logs) by:
//   time of day in New York (ICT entry window 10:00-11:00, AM session 09:30-12:00, rest of the weekday, weekend),
//   US news days (CPI / jobs / FOMC, tools/ict-calendar.mjs),
//   and, for BTC/ETH, the ICT daily bias (last 15m close-break of a confirmed 15m swing before 10:00 NY, bot/ict.mjs) and the
//   rolling version (last 15m break before the entry), each "with" or "against" the trade.
// A split "holds" only if it is >= 0.15R apart with the same sign in both halves (median entry time) and n >= 8 on each side.
// Run: node tools/ict-smc-study.mjs <year.json> <state.json>   (1m bars from tools/ict-backtest.mjs's cache, /tmp/ict-cache)
import fs from 'node:fs';
import {aggregate, structuralBreaks, MIN} from '../bot/ict.mjs';
import {NEWS} from './ict-calendar.mjs';

const [yf, sf] = process.argv.slice(2), CACHE = process.env.ICT_CACHE || '/tmp/ict-cache';
const ny = new Intl.DateTimeFormat('en-US', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'});
const parts = t => Object.fromEntries(ny.formatToParts(new Date(t)).map(p => [p.type, p.value]));
const news = new Set([...NEWS.jobs, ...NEWS.cpi, ...NEWS.fomc]);
const slot = t => { const p = parts(t), m = +p.hour * 60 + +p.minute, wk = p.weekday === 'Sat' || p.weekday === 'Sun';
  return {date: `${p.year}-${p.month}-${p.day}`, wk, win: !wk && m >= 600 && m < 660, am: !wk && m >= 570 && m < 720, min: m}; };

// 15m structural breaks from the cached 1m bars (BTC / ETH)
const breaks = {};
for (const s of ['BTCUSDT', 'ETHUSDT']) {
  const f = fs.readdirSync(CACHE).find(x => x.startsWith(s + '-1m-')); if (!f) continue;
  const bars = JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8')).map(b => ({t: b[0] + MIN, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5]}));
  breaks[s] = structuralBreaks([...aggregate(bars, 15).values()]);
}
const lastBreak = (s, T) => { const a = breaks[s]; if (!a) return null; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].t <= T) lo = m + 1; else hi = m; } return lo ? a[lo - 1] : null; };
// ICT day bias: last break at or before 10:00 NY that day, and after that day's midnight (as backtestIct)
const nyMid = t => { const p = parts(t); return t - ((+p.hour * 60 + +p.minute) * MIN) - (t % MIN); };
const dayBias = (s, t) => { const m0 = nyMid(t), lock = m0 + 600 * MIN; if (t < lock) return null; const b = lastBreak(s, lock); return b && b.t > m0 ? b.direction : null; };

const rows = [];
const y = JSON.parse(fs.readFileSync(yf, 'utf8'));
for (const x of y.trades) rows.push({set: 'year-' + x.v, s: x.s, t0: x.t0, dir: x.side === 'L' || x.side === 'long' ? 1 : -1, R: x.R});
const st = JSON.parse(fs.readFileSync(sf, 'utf8'));
for (const k of ['sm', 'sb', 'se', 'sp']) for (const x of (st[k] && st[k].log) || []) if (Number.isFinite(x.R)) rows.push({set: 'live-' + k, s: x.s, t0: x.t0, dir: x.side === 'L' ? 1 : -1, R: x.R});
for (const r of rows) { Object.assign(r, slot(r.t0)); r.news = !r.wk && news.has(r.date);
  if (breaks[r.s]) { const db = dayBias(r.s, r.t0), lb = lastBreak(r.s, r.t0 - 1); r.dayBias = db == null ? null : db === r.dir ? 'with' : 'against'; r.roll = lb ? (lb.direction === r.dir ? 'with' : 'against') : null; } }

const avg = a => a.length ? a.reduce((s, x) => s + x.R, 0) / a.length : NaN;
const cell = a => `${a.length ? (avg(a) >= 0 ? '+' : '') + avg(a).toFixed(2) : '  - '}R n${a.length} (${a.reduce((s, x) => s + x.R, 0).toFixed(1)})`;
const out = [];
for (const set of [...new Set(rows.map(r => r.set))]) {
  const A = rows.filter(r => r.set === set).sort((a, b) => a.t0 - b.t0), mid = A.length ? A[A.length >> 1].t0 : 0;
  out.push(`\n== ${set}  n ${A.length}  avg ${avg(A).toFixed(2)}R  total ${A.reduce((s, x) => s + x.R, 0).toFixed(1)}R`);
  const tests = [['NY 10:00-11:00 (ICT window)', r => r.win], ['NY AM 09:30-12:00', r => r.am], ['weekend', r => r.wk], ['US news day', r => r.news],
    ['ICT day bias with trade', r => r.dayBias === 'with', r => r.dayBias != null], ['rolling 15m break with trade', r => r.roll === 'with', r => r.roll != null]];
  for (const [name, f, pool] of tests) {
    const P = pool ? A.filter(pool) : A, inn = P.filter(f), oth = P.filter(r => !f(r));
    if (!inn.length) { out.push(`  ${name.padEnd(30)} n 0`); continue; }
    const h = [P.filter(r => r.t0 < mid), P.filter(r => r.t0 >= mid)].map(H => [avg(H.filter(f)), avg(H.filter(r => !f(r))), H.filter(f).length, H.filter(r => !f(r)).length]);
    const holds = h.every(([a, b, na, nb]) => na >= 8 && nb >= 8 && Math.abs(a - b) >= 0.15) && Math.sign(h[0][0] - h[0][1]) === Math.sign(h[1][0] - h[1][1]);
    out.push(`  ${name.padEnd(30)} yes ${cell(inn).padEnd(22)} no ${cell(oth).padEnd(22)} halves ${h.map(([a, b]) => (a - b >= 0 ? '+' : '') + (a - b).toFixed(2)).join(' / ')}${holds ? '  HOLDS' : ''}`);
  }
}
console.log(out.join('\n'));

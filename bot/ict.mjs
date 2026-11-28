// ICT New York morning liquidity reversal. Single-instrument study on completed 1m bars.
// Ported Nov 27 from Fred's patch "aster-ict-study" (core/ict.mjs, written for another codebase). The rules below are the patch's,
// unchanged; only the three helpers it imported from that codebase's core/pmr.mjs are written here. RESEARCH / BACKTEST ONLY:
// nothing here trades or touches the accounts. Driver: tools/ict-backtest.mjs; tests: tests/ict.mjs; notes: docs/ict-study.md.
export const MIN = 60_000;
// bars: completed 1m bars {t, o, h, l, c, v} with t = CLOSE time. A bar is valid when its prices are finite and consistent.
export function validBar(b) {
  return !!b && Number.isSafeInteger(b.t) && [b.o, b.h, b.l, b.c].every(Number.isFinite) && b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c);
}
// completed span-minute bars from 1m bars (t = close time), keyed and stamped by their close time; a frame missing a minute is dropped
export function aggregate(bars, span) {
  const out = new Map(), ms = span * MIN; let cur = null;
  const flush = () => { if (cur && cur.n === span) { delete cur.n; out.set(cur.t, cur); } };
  for (const b of bars) {
    const end = Math.ceil(b.t / ms) * ms;
    if (!cur || cur.t !== end) { flush(); cur = {t: end, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0, n: 1}; }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v || 0; cur.n++; }
  }
  flush();
  return out;
}
// pivots among the first n bars: a high (side 'h') strictly above the k bars on each side, or a low strictly below them.
// t = the pivot bar's close time; knownAt = close time of the k-th bar after it (when it is confirmed). Oldest first.
export function pivots(bars, side, n, k) {
  const out = [];
  for (let i = k; i < n - k; i++) {
    const v = side === 'h' ? bars[i].h : bars[i].l; let ok = true;
    for (let j = 1; j <= k && ok; j++) ok = side === 'h' ? v > bars[i - j].h && v > bars[i + j].h : v < bars[i - j].l && v < bars[i + j].l;
    if (ok) out.push({price: v, t: bars[i].t, knownAt: bars[i + k].t});
  }
  return out;
}

export const ICT_MNQ = Object.freeze({ symbol: 'MNQ', tickSize: 0.25, pointValue: 2, minRange: 10 });
const nyClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const FRAME = 15 * MIN;

function timestamp(t) {
  if (typeof t === 'string' && /(?:Z|[+-]\d\d:\d\d)$/i.test(t)) return Date.parse(t);
  return typeof t === 'number' ? t : NaN;
}

function midnight(date) {
  const noon = Date.parse(date + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(noon) || new Date(noon).toISOString().slice(0, 10) !== date) {
    throw new Error('Session date must be a valid YYYY-MM-DD');
  }
  // All listed sessions are weekdays, so the New York offset is constant between midnight and noon.
  const [hour, minute] = nyClock.format(noon).split(':').map(Number);
  return noon - (hour * 60 + minute) * MIN;
}

function prepareCalendar(sessions) {
  if (!Array.isArray(sessions) || !sessions.length) throw new Error('Supply a cash-session calendar including the reference day');
  const calendar = sessions.map(({ date, kind, news }) => {
    if (!['regular', 'short'].includes(kind) || typeof news !== 'boolean') {
      throw new Error('Each session needs kind: regular or short, and an explicit news boolean');
    }
    const start = midnight(date);
    if ([0, 6].includes(new Date(date + 'T12:00:00Z').getUTCDay())) throw new Error('Cash sessions must be weekdays');
    return { date, kind, news, start, open: start + 570 * MIN, lock: start + 600 * MIN,
      expire: start + 660 * MIN, exit: start + 720 * MIN, close: start + 960 * MIN };
  });
  calendar.sort((a, b) => a.start - b.start);
  if (calendar.some((s, i) => i && s.date === calendar[i - 1].date)) throw new Error('Duplicate cash session');
  return calendar;
}

function prepareClosures(intervals) {
  if (!Array.isArray(intervals)) throw new Error('closures must be an array');
  const closures = intervals.map(({ from, to }) => ({ from: timestamp(from), to: timestamp(to) }));
  closures.sort((a, b) => a.from - b.from);
  for (const [i, { from, to }] of closures.entries()) {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from % MIN || to % MIN || from >= to ||
        (i && from < closures[i - 1].to)) throw new Error('Venue closures must be non-overlapping, minute-aligned intervals');
  }
  return closures;
}

function completeRange(byClose, start, end) {
  const bars = [];
  for (let t = start + MIN; t <= end; t += MIN) {
    const bar = byClose.get(t);
    if (!bar) return null;
    bars.push(bar);
  }
  return bars;
}

function range(bars) {
  return { high: Math.max(...bars.map(b => b.h)), low: Math.min(...bars.map(b => b.l)) };
}

function freshness(byClose, start, end, closures, level) {
  let high = true, low = true;
  let i = closures.findIndex(c => c.to > start);
  if (i < 0) i = closures.length;
  for (let t = start + MIN; t <= end; t += MIN) {
    const b = byClose.get(t);
    if (b) {
      high &&= b.h < level.high;
      low &&= b.l > level.low;
    } else {
      while (closures[i]?.to < t) i++;
      const closure = closures[i];
      if (!closure || closure.from >= t || closure.to < t) return { high: false, low: false, complete: false };
    }
    if (!high && !low) break;
  }
  return { high, low, complete: true };
}

// Detect a close crossing the latest level known before the bar began. Pivot confirmation follows the break check.
export function structuralBreaks(frames) {   // exported for tools/ict-smc-study.mjs (unchanged)
  const events = [];
  const swings = {};
  for (let i = 0; i < frames.length; i++) {
    const b = frames[i], prev = frames[i - 1];
    if (prev?.t === b.t - FRAME) {
      const up = prev.c <= swings.h?.price && b.c > swings.h.price;
      const down = prev.c >= swings.l?.price && b.c < swings.l.price;
      if (up || down) events.push({ t: b.t, direction: up ? 1 : -1, pivot: swings[up ? 'h' : 'l'] });
    }
    if (frames[i - 4]?.t !== b.t - 4 * FRAME) continue;
    const five = frames.slice(i - 4, i + 1);
    for (const side of ['h', 'l']) {
      const pivot = pivots(five, side, five.length, 2)[0];
      if (pivot) swings[side] = { price: pivot.price, t: pivot.t, knownAt: pivot.knownAt };
    }
  }
  return events;
}

function targetTouched(b, d, target) {
  return d * ((d === 1 ? b.h : b.l) - target) >= 0;
}

function costsAt(entry, exit, instrument, costs) {
  return costs.roundTrip + (entry + exit) * instrument.pointValue * costs.feeRate;
}

function netAt(entry, exit, d, instrument, costs) {
  return d * (exit - entry) * instrument.pointValue - costsAt(entry, exit, instrument, costs);
}

function confirmation(context, byClose, premarket, asOf, instrument, costs) {
  const { lock, expire, open, direction: d, opening, target } = context;
  const { tickSize: tick, minRange } = instrument;
  const eps = tick * 1e-7;
  const history = premarket.slice(-32);
  let sweep, swing, mss, extreme;
  let previous = history.at(-1);
  for (let t = lock + MIN; t <= Math.min(expire, asOf); t += MIN) {
    const b = byClose.get(t);
    if (!b) return { status: 'INCOMPLETE', reason: 'MISSING_SETUP_BAR', at: t };
    if (targetTouched(b, d, target)) return { status: 'SKIPPED', reason: 'TARGET_BEFORE_SIGNAL', at: t };
    const edge = d === 1 ? b.l : b.h;
    const level = d === 1 ? opening.low : opening.high;
    if (!sweep && d * (edge - level) <= -tick + eps && d * (b.c - level) > 0) {
      sweep = b;
      swing = pivots(history, d === 1 ? 'h' : 'l', history.length, 2).findLast(p => p.t - MIN >= open);
      extreme = edge;
      if (!swing) return { status: 'SKIPPED', reason: 'NO_SWING_AT_SWEEP', at: t, sweepAt: t };
    } else if (sweep) {
      if (d * (edge - extreme) < 0) extreme = edge;
      if (mss) {
        const lo = d === 1 ? mss.first.h : b.h;
        const hi = d === 1 ? b.l : mss.first.l;
        if (hi - lo < tick - eps) return { status: 'SKIPPED', reason: 'NO_FVG', at: t, sweepAt: sweep.t, mssAt: mss.at };
        if (t >= expire) return { status: 'SKIPPED', reason: 'WINDOW_ENDED', at: t };
        if (d * (target - extreme) < minRange - eps) return { status: 'SKIPPED', reason: 'RANGE_TOO_SMALL', at: t };
        const round = d === 1 ? Math.floor : Math.ceil;
        const roundPrice = value => Number((round(value / tick + d * 1e-7) * tick).toPrecision(14));
        const entry = roundPrice((lo + hi) / 2), stop = roundPrice(extreme - d * tick);
        const riskUnit = -netAt(entry, stop - d * costs.stopSlippageTicks * tick, d, instrument, costs);
        const rewardUnit = netAt(entry, target, d, instrument, costs);
        const netRR = riskUnit > 0 ? rewardUnit / riskUnit : 0;
        const plan = { id: 'ict-' + instrument.symbol + '-' + t, symbol: instrument.symbol, direction: d, entry, stop, target,
          fvg: { lo, hi, knownAt: t }, sweepAt: sweep.t, mssAt: mss.at, swing, signalAt: t, expiresAt: expire, timeExitAt: context.exit,
          riskUnit, rewardUnit, netRR };
        return netRR + 1e-9 < 2 || stop <= 0
          ? { status: 'SKIPPED', reason: 'NET_RR', at: t, plan }
          : { status: 'PENDING', plan };
      }
      if (t > sweep.t + 10 * MIN) return { status: 'SKIPPED', reason: 'MSS_TIMEOUT', at: t, sweepAt: sweep.t };
      if (d * (b.c - swing.price) > 0) {
        const bodies = history.slice(-20).map(x => Math.abs(x.c - x.o)).sort((a, b) => a - b);
        const median = (bodies[9] + bodies[10]) / 2;
        const nearExtreme = d === 1 ? b.h - b.c : b.c - b.l;
        if (!(median > 0) || d * (b.c - b.o) < 1.5 * median - eps || nearExtreme > (b.h - b.l) / 4 + eps) {
          return { status: 'SKIPPED', reason: 'WEAK_MSS', at: t, sweepAt: sweep.t };
        }
        mss = { at: t, first: previous };
      }
    }
    history.push(b);
    previous = b;
  }
  return asOf < expire
    ? { status: 'WAITING', reason: mss ? 'FVG' : sweep ? 'MSS' : 'SWEEP' }
    : { status: 'SKIPPED', reason: sweep ? 'WINDOW_ENDED' : 'NO_SWEEP', at: expire };
}

// OHLC study: trade through limits by a tick, stop beats target, target on the fill bar is ambiguous.
function replay(plan, byClose, asOf, instrument, costs) {
  const { direction: d, entry, target, stop, expiresAt, timeExitAt } = plan;
  const tick = instrument.tickSize, eps = tick * 1e-7;
  let fillAt = null;
  let ambiguous = false;
  const finish = (price, at, why, slip = 0) => {
    const exit = price - d * slip * tick;
    const pnl = netAt(entry, exit, d, instrument, costs);
    return { status: 'CLOSED', reason: why, plan, trade: { s: plan.symbol, side: d === 1 ? 'long' : 'short',
      t0: fillAt, t1: at, entry, exit, why, pnl, R: pnl / plan.riskUnit, ambiguous } };
  };
  for (let t = plan.signalAt + MIN; t <= Math.min(asOf, timeExitAt + MIN); t += MIN) {
    if (fillAt === null && t > expiresAt) break;
    const b = byClose.get(t);
    if (!b) return { status: 'INCOMPLETE', reason: 'MISSING_EXECUTION_BAR', at: t, plan, fillAt, ambiguous };
    if (fillAt === null) {
      if (d * (b.o - target) >= 0) return { status: 'CANCELLED', reason: 'TARGET_BEFORE_FILL', at: t - MIN, plan };
      const fill = d * ((d === 1 ? b.l : b.h) - entry) <= -tick + eps;
      if (!fill && targetTouched(b, d, target)) return { status: 'CANCELLED', reason: 'TARGET_BEFORE_FILL', at: t, plan };
      if (!fill) continue;
      fillAt = t;
      ambiguous = targetTouched(b, d, target);
    }
    if (d * (b.o - stop) <= 0) return finish(b.o, fillAt === t ? t : t - MIN, 'Stop', costs.stopSlippageTicks);
    if (t - MIN >= timeExitAt) return finish(b.o, t - MIN, 'Time exit', costs.timeSlippageTicks);
    if (d * ((d === 1 ? b.l : b.h) - stop) <= 0) return finish(stop, t, 'Stop', costs.stopSlippageTicks);
    if (t > fillAt && d * ((d === 1 ? b.h : b.l) - target) >= tick - eps) return finish(target, t, 'Target');
  }
  if (fillAt !== null) return { status: 'OPEN', plan, fillAt, ambiguous };
  return asOf >= expiresAt ? { status: 'EXPIRED', reason: 'NO_FILL', at: expiresAt, plan } : { status: 'PENDING', plan };
}

export function backtestIct({ bars, sessions, closures = [], instrument = ICT_MNQ, costs, asOf }) {
  const { symbol, tickSize, pointValue, minRange } = instrument;
  if (typeof symbol !== 'string' || !symbol || ![tickSize, pointValue, minRange].every(n => Number.isFinite(n) && n > 0)) {
    throw new Error('Supply symbol, tickSize, pointValue and minRange for the instrument');
  }
  if (!costs || !Number.isFinite(costs.roundTrip)) throw new Error('Supply estimated roundTrip cost explicitly, including zero if intended');
  const pricing = { roundTrip: 0, feeRate: 0, stopSlippageTicks: 0, timeSlippageTicks: 0, ...costs };
  if (Object.values(pricing).some(n => !Number.isFinite(n) || n < 0) ||
      ![pricing.stopSlippageTicks, pricing.timeSlippageTicks].every(Number.isInteger)) throw new Error('Invalid cost assumptions');

  const calendar = prepareCalendar(sessions);
  const venueClosures = prepareClosures(closures);
  if (!Array.isArray(bars) || !bars.length) throw new Error('Supply completed 1m bars');
  const all = bars.map(b => ({ ...b, t: timestamp(b?.t) })).sort((a, b) => a.t - b.t);
  if (all.some((b, i) => !validBar(b) || (i && b.t === all[i - 1].t))) throw new Error('Invalid or duplicate completed 1m bar');
  const cutoff = asOf === undefined ? all.at(-1).t : timestamp(asOf);
  if (!Number.isSafeInteger(cutoff)) throw new Error('Invalid asOf timestamp');
  const observed = all.filter(b => b.t <= cutoff);
  const byClose = new Map(observed.map(b => [b.t, b]));
  const breaks = structuralBreaks([...aggregate(observed, 15).values()]);
  const days = [];
  let prior;
  let j = 0;
  for (const day of calendar) {
    if (day.start >= cutoff) break;
    while (j < breaks.length && breaks[j].t <= day.lock) j++;
    const bias = breaks[j - 1];
    const reference = prior;
    if (day.kind === 'regular') prior = day;
    const result = evaluateDay(day, reference, bias, byClose, cutoff, venueClosures, instrument, pricing);
    days.push({ date: day.date, ...result });
  }
  return { strategy: 'ICT_NY_AM_REVERSAL', symbol, asOf: cutoff, days,
    trades: days.flatMap(day => day.trade ? [day.trade] : []) };
}

function evaluateDay(day, reference, bias, byClose, cutoff, closures, instrument, costs) {
  const { start, open, lock } = day;
  if (day.kind === 'short' || day.news) return { status: 'SKIPPED', reason: day.kind === 'short' ? 'SHORT_SESSION' : 'SCHEDULED_NEWS' };
  if (cutoff < lock) return { status: 'WAITING', reason: 'OPENING_RANGE' };
  if (!reference) return { status: 'SKIPPED', reason: 'WARMUP' };
  const premarket = completeRange(byClose, start, lock);
  const priorBars = completeRange(byClose, reference.open, reference.close);
  if (!premarket || !priorBars) return { status: 'INCOMPLETE', reason: 'MISSING_REFERENCE_BARS' };
  if (!bias || bias.t <= start) return { status: 'SKIPPED', reason: 'NO_BIAS' };
  const opening = range(premarket.slice(-(lock - open) / MIN));
  const priorRange = range(priorBars);
  const fresh = freshness(byClose, reference.close, lock, closures, priorRange);
  const d = bias.direction;
  const referencePrice = premarket.at(-1).c;
  const levels = d === 1 ? [opening.high, fresh.high ? priorRange.high : null] : [opening.low, fresh.low ? priorRange.low : null];
  const target = levels.filter(p => p !== null && d * (p - referencePrice) > 0).sort((a, b) => d * (a - b))[0];
  const context = { ...day, direction: d, opening, target, referencePrice, bias, priorRange, priorDate: reference.date, fresh };
  if (target === undefined) return { status: 'SKIPPED', reason: 'NO_TARGET', context };
  const result = confirmation(context, byClose, premarket, cutoff, instrument, costs);
  return { context, ...(result.status === 'PENDING' ? replay(result.plan, byClose, cutoff, instrument, costs) : result) };
}
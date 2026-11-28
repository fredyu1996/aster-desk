import assert from 'node:assert/strict';
import { test } from 'node:test';
// The patch's own tests (test/ict.test.mjs), ported unchanged apart from the import paths.
import { backtestIct, ICT_MNQ, MIN } from '../bot/ict.mjs';

const winter = { prior: '2026-11-20', today: '2026-11-23', offset: '05:00' };
const summer = { prior: '2026-07-09', today: '2026-07-10', offset: '04:00' };

function fixture({ dates = winter, side = 1, changes = {}, priorHigh = 20100 } = {}) {
  const start = Date.parse(dates.today + 'T' + dates.offset + ':00Z');
  const prior = Date.parse(dates.prior + 'T' + dates.offset + ':00Z');
  const at = m => start + m * MIN;
  const priorClose = prior + 960 * MIN;
  const history = Array.from({ length: 390 }, (_, i) => ({
    t: prior + (571 + i) * MIN, o: 20000, h: priorHigh, l: 19995, c: 20001, v: 1,
  }));
  const today = Array.from({ length: 721 }, (_, m) => {
    const bar = { t: at(m + 1), o: 20006, h: 20008, l: 20003, c: 20006.5, v: 1 };
    if (m === 370) bar.h = 20020;
    if (m >= 480 && m < 495) Object.assign(bar, { o: 20024, h: 20026, l: 20023, c: 20025 });
    const patch = {
      571: { l: 20000 },
      575: { h: 20035.5 },
      605: { h: 20009.25 },
      608: { l: 19999.75 },
      609: { h: 20008.75 },
      610: { o: 20006.75, h: 20011.25, l: 20006.25, c: 20010.75 },
      611: { o: 20011, h: 20012, l: 20010.25, c: 20011.25 },
      612: { o: 20011.25, h: 20012, l: 20009.25, c: 20010.5 },
      613: { o: 20010.5, h: 20035.75, l: 20010.25, c: 20030 },
    }[m];
    if (m >= 614) Object.assign(bar, { o: 20010.5, h: 20012, l: 20010.25, c: 20010.5 });
    return Object.assign(bar, patch, changes[m]);
  });
  const bars = history.concat(today).map(b => side === 1 ? b : {
    ...b, o: 40000 - b.o, h: 40000 - b.l, l: 40000 - b.h, c: 40000 - b.c,
  });
  return { at, bars, instrument: ICT_MNQ, costs: { roundTrip: 4 }, closures: [{ from: priorClose, to: start }],
    sessions: [{ date: dates.prior, kind: 'regular', news: false }, { date: dates.today, kind: 'regular', news: false }] };
}

const current = (input, asOf) => backtestIct({ ...input, asOf }).days.at(-1);

test('ICT matches the documented MNQ trade and the mirrored short', () => {
  for (const side of [1, -1]) {
    const input = fixture({ side });
    const day = current(input);
    const price = p => side === 1 ? p : 40000 - p;
    assert.equal(day.status, 'CLOSED');
    assert.equal(day.plan.direction, side);
    assert.equal(day.plan.sweepAt, input.at(609));
    assert.equal(day.plan.swing.knownAt, input.at(608));
    assert.equal(day.plan.mssAt, input.at(611));
    assert.equal(day.plan.signalAt, input.at(612));
    assert.equal(day.plan.entry, price(20009.5));
    assert.equal(day.plan.stop, price(19999.5));
    assert.equal(day.plan.target, price(20035.5));
    assert.equal(day.plan.riskUnit, 24);
    assert.equal(day.plan.netRR, 2);
    assert.equal(day.trade.t0, input.at(613));
    assert.equal(day.trade.why, 'Target');
    assert.equal(day.trade.pnl, 48);
    assert.equal(day.trade.R, 2);
  }
});

test('ICT cutoffs are causal and New York times follow DST', () => {
  for (const dates of [winter, summer]) {
    const input = fixture({ dates });
    const signal = input.at(612);
    assert.equal(current(input, signal - MIN).reason, 'FVG');
    const pending = current(input, signal);
    assert.equal(pending.status, 'PENDING');
    assert.equal(pending.plan.expiresAt, input.at(660));
    assert.deepEqual(pending, current({ ...input, bars: input.bars.filter(b => b.t <= signal) }));
    assert.equal(current(input, signal + MIN).status, 'OPEN');
  }
});

test('ICT requires a pivot confirmed before the sweep and freezes the opening bias', () => {
  const unconfirmed = fixture({ changes: {
    576: { h: 20035.5 }, 605: { h: 20008 }, 607: { h: 20009.25 }, 608: { h: 20008.5 },
  } });
  const day = current(unconfirmed, unconfirmed.at(609));
  assert.equal(day.status, 'SKIPPED');
  assert.equal(day.reason, 'NO_SWING_AT_SWEEP');
  const noBias = fixture({ changes: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [
    480 + i, { o: 20006, h: 20008, l: 20003, c: 20006.5 },
  ])) });
  assert.equal(current(noBias).reason, 'NO_BIAS');
});

test('ICT stops a weak first MSS, an absent FVG and a below-cost R:R', () => {
  assert.equal(current(fixture({ changes: { 610: { o: 20010.75 } } })).reason, 'WEAK_MSS');
  assert.equal(current(fixture({ changes: { 611: { l: 20008.75 } } })).reason, 'NO_FVG');
  assert.equal(current({ ...fixture(), costs: { roundTrip: 4.5 } }).reason, 'NET_RR');
});

test('ICT treats observed and unobserved prior highs differently', () => {
  const changes = { 599: { h: 20035.5, c: 20035.5 } };
  const input = fixture({ changes, priorHigh: 20040.5 });
  assert.equal(current(input).plan.target, 20040.5);
  const unknown = current({ ...input, closures: [] });
  assert.equal(unknown.context.fresh.complete, false);
  assert.equal(unknown.reason, 'NO_TARGET');
  const hit = fixture({ changes: { ...changes, 200: { h: 20041 } }, priorHigh: 20040.5 });
  assert.equal(current(hit).reason, 'NO_TARGET');
});

test('ICT skips news or short days and reports missing reference and execution bars', () => {
  const input = fixture();
  const update = patch => ({ ...input, sessions: [input.sessions[0], { ...input.sessions[1], ...patch }] });
  assert.equal(current(update({ news: true })).reason, 'SCHEDULED_NEWS');
  assert.equal(current(update({ kind: 'short' })).reason, 'SHORT_SESSION');
  assert.equal(current({ ...input, bars: input.bars.filter(b => b.t !== input.at(200)) }).reason, 'MISSING_REFERENCE_BARS');
  const gap = current({ ...input, bars: input.bars.filter(b => b.t !== input.at(614)) });
  assert.equal(gap.reason, 'MISSING_EXECUTION_BAR');
  assert.equal(gap.fillAt, input.at(613));
  assert.throws(() => backtestIct({ ...input, bars: input.bars.concat(input.bars[0]) }), /duplicate/);
});

test('ICT limit touch alone does not fill and a target reached without a fill cancels', () => {
  const input = fixture({ changes: { 612: { l: 20009.5 } } });
  assert.equal(current(input, input.at(613)).status, 'PENDING');
  assert.equal(current(input).reason, 'TARGET_BEFORE_FILL');
  const noRetest = fixture({ changes: { 612: { l: 20010 }, 613: { h: 20012, c: 20011 } } });
  assert.equal(current(noRetest, noRetest.at(660)).status, 'EXPIRED');
});

test('ICT stop takes precedence on the entry bar and gaps apply adverse slippage', () => {
  const ambiguous = fixture({ changes: { 612: { l: 19999.5, h: 20035.75 } } });
  const stopped = current(ambiguous);
  assert.equal(stopped.trade.why, 'Stop');
  assert.equal(stopped.trade.ambiguous, true);
  const gap = fixture({ changes: { 613: { o: 19999, l: 19998, c: 19999 } } });
  const stoppedGap = current({ ...gap, costs: { roundTrip: 3.25, stopSlippageTicks: 1 } });
  assert.equal(stoppedGap.trade.exit, 19998.75);
  assert.equal(stoppedGap.trade.t1, gap.at(613));
});

test('ICT target on the entry bar is flagged and the noon exit uses the next bar open', () => {
  const input = fixture({ changes: { 612: { h: 20035.75 }, 613: { h: 20012, c: 20011 }, 720: { o: 20011, c: 20010.5 } } });
  assert.equal(current(input, input.at(613)).status, 'OPEN');
  assert.equal(current(input, input.at(720)).status, 'OPEN');
  const closed = current(input);
  assert.equal(closed.trade.why, 'Time exit');
  assert.equal(closed.trade.ambiguous, true);
  assert.equal(closed.trade.exit, 20011);
  assert.equal(closed.trade.t1, input.at(720));
});

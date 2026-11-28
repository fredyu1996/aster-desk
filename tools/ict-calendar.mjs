// US cash-session calendar for the ICT NY-morning study (bot/ict.mjs), Nov 20 2025 → Nov 27 2026. Checked Nov 27 2026 against:
//   NYSE holidays / early closes: nyse.com/trade/hours-calendars and the ICE 2026 calendar announcement (Dec 23 2025);
//     2025: Thanksgiving Nov 27, early close Nov 28 and Dec 24, Christmas Dec 25.
//   Employment Situation and CPI: bls.gov/schedule/news_release/empsit.htm, cpi.htm, the 2026 monthly schedules and
//     bls.gov/bls/2025-lapse-revised-release-dates.htm (shutdown moves: Sept jobs Nov 20, Nov jobs Dec 16, Nov CPI Dec 18 2025;
//     Jan 2026 jobs Feb 11, Jan CPI Feb 13).
//   FOMC decision days (second day of each meeting): federalreserve.gov/monetarypolicy/fomccalendars.htm.
export const HOLIDAYS = ['2025-11-27', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26'];
export const SHORT = ['2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24'];
export const NEWS = {
  jobs: ['2025-11-20', '2025-12-16', '2026-01-09', '2026-02-11', '2026-03-06', '2026-04-03', '2026-05-08', '2026-06-05', '2026-07-02', '2026-08-07', '2026-09-04', '2026-10-02', '2026-11-06'],
  cpi: ['2025-12-18', '2026-01-13', '2026-02-13', '2026-03-11', '2026-04-10', '2026-05-12', '2026-06-10', '2026-07-14', '2026-08-12', '2026-09-11', '2026-10-14', '2026-11-10'],
  fomc: ['2025-12-10', '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28'],
};
// every NYSE session from `from` to `to` (YYYY-MM-DD, inclusive) in the format backtestIct wants
export function sessions(from, to, {news = true} = {}) {
  const nw = new Set(news ? [...NEWS.jobs, ...NEWS.cpi, ...NEWS.fomc] : []), out = [];
  for (let t = Date.parse(from + 'T12:00:00Z'); t <= Date.parse(to + 'T12:00:00Z'); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10), wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6 || HOLIDAYS.includes(d)) continue;
    out.push({date: d, kind: SHORT.includes(d) ? 'short' : 'regular', news: nw.has(d)});
  }
  return out;
}

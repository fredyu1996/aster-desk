/* ================= TIME MACHINE (Fred, Nov 27: "開 branch 加時光機落 crypto desk") =================
   Record only: never gates, sizes or exits a trade. When an SMC account opens a position, replay the rest of the trade
   thousands of times from the coin's own last 60 days of 5m bars and record the odds of target first vs stop first
   (pos.tm, copied to the trade log). Method from Jakeschincariol/day-trader-skill `trader-timemachine` (MIT), as already
   ported to the stock desk (fredyu1996/aster-stocl-desk core/timemachine.mjs): bootstrap each next bar from the same time of
   day (± 2 bars) as a ratio to the previous close, stop before target inside a bar, seeded PRNG (seed 19) so a result
   repeats. Crypto trades 24 h: 288 five-minute slots per day, replay horizon 24 h. tag: 'favour' / 'even' / 'against' =
   target-first share among paths that hit a side, vs the break-even 1 / (1 + R), ± 5 points.
   Bars K: Binance-style arrays [openTime, o, h, l, c, …] (strings or numbers), closed bars only. */
const TM = {slots: 288, m5: 300e3, day: 864e5, q: [], run: null};
function tmRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// plan: {t: entry time, side 'L'|'S', entry, stop, target}
function tmRun(plan, K, opt) {
  const o = Object.assign({n: 5000, seed: 19, horizonBars: 288, lookbackDays: 60, minDays: 20}, opt || {});
  const M5 = TM.m5, from = plan.t - o.lookbackDays * TM.day, pool = Array.from({length: TM.slots}, () => []), days = new Set();
  for (let i = 1; i < (K || []).length; i++) {
    const b = K[i], p = K[i - 1], t = +b[0], pc = +p[4];
    if (t + M5 > plan.t || t < from || t - +p[0] !== M5 || !(pc > 0)) continue;
    pool[Math.floor((t % TM.day) / M5)].push([+b[1] / pc, +b[2] / pc, +b[3] / pc, +b[4] / pc]);
    days.add(Math.floor(t / TM.day));
  }
  if (days.size < o.minDays) return null;
  const d = plan.side === 'L' ? 1 : -1, risk = Math.abs(plan.entry - plan.stop), reward = Math.abs(plan.target - plan.entry);
  if (!(risk > 0) || !(reward > 0)) return null;
  const R = reward / risk, rand = tmRng(o.seed), start = Math.floor(((Math.floor(plan.t / M5) * M5) % TM.day) / M5);
  let tF = 0, sF = 0, sumR = 0;
  for (let k = 0; k < o.n; k++) {
    let px = plan.entry, out = null;
    for (let j = 0; j < o.horizonBars && out === null; j++) {
      const s = (start + j) % TM.slots; let sh = null;
      for (let tries = 0; tries < 6 && !sh; tries++) { const L = pool[(s + Math.floor(rand() * 5) - 2 + TM.slots) % TM.slots]; if (L.length) sh = L[Math.floor(rand() * L.length)]; }
      if (!sh) continue;
      const hi = px * sh[1], lo = px * sh[2];
      if (d === 1 ? lo <= plan.stop : hi >= plan.stop) out = -1;
      else if (d === 1 ? hi >= plan.target : lo <= plan.target) out = R;
      px *= sh[3];
    }
    if (out === -1) sF++; else if (out === R) tF++;
    sumR += out === null ? d * (px - plan.entry) / risk : out;
  }
  const hit = tF + sF, share = hit ? tF / hit : null, be = 1 / (1 + R), lean = share == null ? null : share - be, r3 = v => v == null ? null : Math.round(v * 1000) / 1000;
  return {pT: r3(tF / o.n), pS: r3(sF / o.n), pN: r3((o.n - hit) / o.n), avgR: r3(sumR / o.n), share: r3(share), be: r3(be), lean: r3(lean),
    tag: lean == null ? '?' : lean >= 0.05 ? 'favour' : lean <= -0.05 ? 'against' : 'even', days: days.size, n: o.n, seed: o.seed};
}
const TM_ZH = {favour: '偏 target', even: '五五波', against: '偏 stop', '?': '數據唔夠'};
function tmTxt(tm) { return tm ? `時光機 ${TM_ZH[tm.tag] || tm.tag} · target 先到 ${Math.round(tm.pT * 100)}% / stop ${Math.round(tm.pS * 100)}% · 要 ${Math.round(tm.be * 100)}% 先打和，實際 ${tm.share == null ? '—' : Math.round(tm.share * 100) + '%'} (${tm.days} 日, seed ${tm.seed})` : ''; }

// Live: queue a position for its Time Machine read (60 days of 5m bars = 12 requests). acct = the account object (SM / SB / SE / SP).
function tmAsk(acct, s) {
  const p = acct && acct.pos && acct.pos[s]; if (TM.off || !p || p.tm !== undefined) return;   // TM.off: backtests (they compute it from their own candles)
  p.tm = null;   // null = asked, filled in when the bars arrive
  TM.q.push({acct, s, t: p.t, plan: {t: p.t, side: p.side, entry: p.entry, stop: p.stop0, target: p.target}});
  if (typeof window !== 'undefined') tmFlush().then(n => { if (n && typeof smSave === 'function') smSave(); }).catch(() => {});
}
async function tmBars(s, t) {
  const M5 = TM.m5, out = []; let from = t - 61 * TM.day;
  for (let g = 0; g < 14 && from < t; g++) {
    const a = await api(`/fapi/v1/klines?symbol=${s}&interval=5m&startTime=${from}&limit=1500`);
    if (!Array.isArray(a) || !a.length) break;
    for (const b of a) if (+b[0] + M5 <= t) out.push(b);
    const next = +a[a.length - 1][0] + M5; if (a.length < 1500 || next <= from) break; from = next;
  }
  return out;
}
// Work the queue; returns how many positions / trades got a read. The cloud awaits it before saving.
function tmFlush() {
  if (TM.run) return TM.run.then(() => tmFlush());   // one worker; a second caller waits for it, then drains what is left
  TM.run = tmWork().finally(() => { TM.run = null; });
  return TM.run;
}
async function tmWork() {
  let done = 0;
  {
    while (TM.q.length) {
      const j = TM.q.shift();
      let tm = null; try { tm = tmRun(j.plan, await tmBars(j.s, j.t)); } catch (e) { tm = null; }
      const p = j.acct.pos[j.s];
      if (p && p.t === j.t) p.tm = tm;
      else { const x = (j.acct.log || []).find(x => x.s === j.s && x.t0 === j.t); if (x) x.tm = tm; }
      done++;
    }
  }
  return done;
}

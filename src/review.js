/* ================= REVIEWER: grades the Trader's closed trades and rewrites the rules ================= */
// Loop: Trader closes trades → Reviewer grades each one → every few trades the Reviewer writes a review with
// evidence-based rule changes → the Trader reads it, accepts or adjusts each change, checks how the new rules
// would have treated the last 24h of candidates, and only then goes back to entering trades.
// (Reviewer state RV is declared in trader.js so the Trader can read it at startup)
const RV_WIN = 40;
const rvMean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const fmtR = r => fin(r) ? (r >= 0 ? '+' : '') + r.toFixed(2) + 'R' : '—';
// Fred's own reviews of closed trades: {key: {g, ag, alt[], x[], note, excl, t, by}}. Kept on branch "notes" of the data
// repo (file manual-reviews.json) so any computer, viewer or not, can add one; the cloud reads it each run.
let RVM = LS.get('awx_mine', {}) || {};
const mineKey = x => (x.strat === 'smc' ? 'sm' : 'pt') + '|' + x.s + '|' + x.t1;
const mineOf = x => RVM[mineKey(x)] || null;
// trades closed by hand, or that Fred marked "leave out", are not used for grading statistics, rules or criteria
const rvManual = x => /closed by you/.test(x.exitWhy || '') || !!(RVM[mineKey(x)] && RVM[mineKey(x)].excl);
const rvStage = x => x.st ? (String(x.st).startsWith('done') ? 'done' : 'rev') : (/Reversed/.test(x.why || '') ? 'done' : 'rev');
const rvExitKind = x => { const e = x.exitWhy || ''; return /unlock/.test(e) ? 'Closed before unlock' : /forming against/.test(e) ? 'Reversal against momentum' : /closed by you/.test(e) ? 'Closed by you' : /target/.test(e) ? 'Hit target' : /trailing/.test(e) ? 'Trailing stop' : /breakeven/.test(e) ? 'Breakeven stop' : /stop loss/.test(e) ? 'Stop loss' : /faded/.test(e) ? 'Signals faded' : /time stop/.test(e) ? 'Time stop' : 'Other'; };
function rvAgg(a) { const R = a.map(x => x.R); return {n: a.length, avgR: rvMean(R), win: a.length ? a.filter(x => x.R > 0).length / a.length * 100 : null, sum: R.reduce((p, q) => p + q, 0)}; }
function rvGroup(T, fn) { const m = {}; for (const x of T) { const k = fn(x); if (!k) continue; (m[k] = m[k] || []).push(x); } return Object.fromEntries(Object.entries(m).map(([k, a]) => [k, rvAgg(a)])); }
function rvBlank() { return {score: 0, riskMul: 1, tp1R: null, tpR: null, stopBuf: null, holdH: null, volMul: 1, side: {L: {score: 0, mul: 1}, S: {score: 0, mul: 1}}, avoid: [], prefer: [], needConf: false, fundGuard: false, unlDays: null, mom: {score: 0, mul: 1}}; }

/* ---- per-trade grade (process, not just outcome) ---- */
function rvGrade(x) {
  const held = (x.t1 - x.t0) / 60e3, R = x.R, ex = x.exitWhy || '';
  if (rvManual(x)) return {g: '—', note: 'Closed by you, not graded'};
  if (R >= 1.5) return {g: 'A', note: /target/.test(ex) ? 'Full target hit. The plan worked.' : 'Banked the partial and trailed the rest. The plan worked.'};
  if (R >= 0.3) return {g: 'B', note: x.maxR >= 1.5 ? `Won, but gave back ${(x.maxR - R).toFixed(1)}R from the best point` : 'Small win'};
  if (R < -1.3) return {g: 'F', note: `Lost ${(-R).toFixed(1)}R, more than the planned 1R (slippage or a gap through the stop)`};
  if (x.maxR >= 1) return {g: 'D', note: `Was +${x.maxR.toFixed(1)}R, finished ${fmtR(R)}. Profit wasn't protected.`};
  if (/stop loss/.test(ex) && held < 45) return {g: 'D', note: `Stopped out after ${Math.max(1, Math.round(held))} min: entry too early or stop too tight`};
  if (/faded|forming against/.test(ex) && R < -0.2) return {g: 'D', note: x.strat === 'mom' ? 'Momentum died soon after entry: chased a move that was already ending' : 'Reversal signs faded soon after entry: entered before confirmation'};
  if (R > -0.3) return {g: 'C', note: /time stop/.test(ex) ? 'Went nowhere until the time stop' : 'Scratch'};
  return {g: 'C', note: 'Clean loss inside the plan (about 1R). Following the rules is fine.'};
}
// After a stop-out, check the next few hours: did price go on to hit the +1.5R level anyway? (only for coins with candles loaded)
function rvPostCheck(x) {
  if (x.post || !/stop loss/.test(x.exitWhy || '')) return;
  const age = now() - x.t1; if (age < 4 * 3600e3) return;
  if (age > 22 * 3600e3) { x.post = {chk: false}; return; }
  const k = S.kl.get(x.s); if (!k) return;
  const after = k.bars.filter(b => b[0] >= x.t1); if (after.length < 12) return;
  const d = Math.abs(x.entry - x.stop0), L = x.side === 'L', tp = x.entry + (L ? 1 : -1) * 1.5 * d;
  x.post = {chk: true, hit: after.some(b => L ? b[2] >= tp : b[3] <= tp)};
}

/* ---- the review: find what's working and what isn't, propose rule changes ---- */
let RV_HELD = [];   // rules your disagreement held in the latest analysis (never kept on by the sticky logic)
function rvAnalyze(TA) {
  RV_HELD = [];
  // most rules are learned from reversal trades only; momentum trades get their own rule below
  const T = TA.filter(x => (x.strat || 'rev') === 'rev'), TM = TA.filter(x => x.strat === 'mom');
  const p = rvBlank(), why = {}, base = PT.cfg, O = rvAgg(T), OA = rvAgg(TA);
  const wins = TA.filter(x => x.pnl > 0), losses = TA.filter(x => x.pnl <= 0);
  const gw = wins.reduce((a, x) => a + x.pnl, 0), gl = -losses.reduce((a, x) => a + x.pnl, 0);
  const fees = TA.reduce((a, x) => a + x.fees, 0), fund = TA.reduce((a, x) => a + (x.funding || 0), 0);
  const G = {strat: rvGroup(TA, x => x.strat === 'mom' ? 'Momentum (with the move)' : 'Reversal (against the move)'), side: rvGroup(TA, x => (x.strat === 'mom' ? 'Momentum ' : 'Reversal ') + (x.side === 'L' ? 'longs' : 'shorts')), tag: rvGroup(T, x => x.tag || 'untagged'),
    stage: rvGroup(T, x => rvStage(x) === 'done' ? 'Entered at "Reversed"' : 'Entered at "Reversal forming"'), exit: rvGroup(T, rvExitKind),
    score: rvGroup(T, x => fin(x.sc) ? x.sc + '/8 signs' : null),
    unl: rvGroup(TA, x => !x.unlK ? null : (x.side === 'L' ? 'Long' : 'Short') + (x.unlK === 'ahead' ? ', big unlock ahead' : x.unlK === 'after' ? ', just after a big unlock' : ', no unlock nearby'))};
  // 1 · overall edge
  if (O.n >= 6 && O.avgR < -0.25) {
    p.score = O.n >= 10 && O.avgR < -0.5 ? 2 : 1; p.riskMul = p.score === 2 ? 0.5 : 0.75;
    why.score = why.risk = `Reversal trades averaged ${fmtR(O.avgR)} over ${O.n} trades. The edge is negative, so be pickier and smaller until it recovers.`;
  }
  // 2 · one side losing
  const sd = rvGroup(T, x => x.side);
  for (const k of ['L', 'S']) {
    const a = sd[k], o = sd[k === 'L' ? 'S' : 'L']; if (!a || a.n < 4) continue;
    if (a.avgR < -0.4 && (!o || o.n < 4 || o.avgR > a.avgR + 0.4)) {
      p.side[k].score = 1; if (a.n >= 6 && a.avgR < -0.6) p.side[k].mul = 0.5;
      why['side' + k] = `${k === 'L' ? 'Longs' : 'Shorts'}: ${a.n} trades, avg ${fmtR(a.avgR)}, ${a.win.toFixed(0)}% win${o && o.n ? `, vs ${fmtR(o.avgR)} on the other side` : ''}.`;
    }
  }
  // 3 · setup tags that keep losing / winning
  for (const [k, a] of Object.entries(rvGroup(T, x => x.tag || null))) {
    if (a.n < 3) continue;
    if (a.avgR <= -0.5 && a.win <= 34) { p.avoid.push(k); why['tag:' + k] = `"${k}" setups: ${a.n} trades, avg ${fmtR(a.avgR)}, ${a.win.toFixed(0)}% win.`; }
    else if (a.avgR >= 0.5) { p.prefer.push(k); why['pref:' + k] = `"${k}" setups: ${a.n} trades, avg ${fmtR(a.avgR)}, ${a.win.toFixed(0)}% win. Take these first.`; }
  }
  // 4 · entering before confirmation
  const st = rvGroup(T, rvStage), fo = st.rev, dn = st.done;
  if (fo && fo.n >= 4 && fo.avgR < -0.3 && (!dn || dn.n < 2 || dn.avgR >= fo.avgR + 0.5)) {
    p.needConf = true; why.conf = `Entries at "Reversal forming": ${fo.n} trades, avg ${fmtR(fo.avgR)}${dn && dn.n ? `. At "Reversed": ${dn.n} trades, avg ${fmtR(dn.avgR)}` : ''}.`;
  }
  // 5 · giving back open profit
  const nonW = T.filter(x => x.R < 0.2), gb = nonW.filter(x => x.maxR >= 1);
  if (gb.length >= 3 && gb.length / nonW.length >= 0.25) {
    const v = gb.length / nonW.length >= 0.35 ? 1.0 : 1.2;
    if (v < base.tp1R) { p.tp1R = v; why.tp1R = `${gb.length} of ${nonW.length} losing or flat trades were at least +1R first, then gave it back.`; }
  }
  // 6 · target too far or too close
  const tgt = T.filter(x => /target/.test(x.exitWhy || '')), W = T.filter(x => x.R > 0.3);
  if (tgt.length >= 3 && tgt.length / T.length >= 0.3) { p.tpR = base.tpR + 1; why.tpR = `${tgt.length} of ${T.length} trades hit the +${base.tpR}R target. Moves are running further, so let winners run.`; }
  else if (W.length >= 4 && !tgt.length) {
    const m = rvMean(W.map(x => x.maxR));
    if (m < base.tpR - 0.7) { p.tpR = Math.max(base.tp1R + 0.5, Math.round(m * 2) / 2); why.tpR = `None of ${W.length} winners reached +${base.tpR}R. They topped out around +${m.toFixed(1)}R on average.`; }
  }
  // 7 · stops inside the noise
  const sl = T.filter(x => /stop loss/.test(x.exitWhy || '')), quick = sl.filter(x => x.t1 - x.t0 < 45 * 60e3), back = sl.filter(x => x.post && x.post.hit);
  if ((quick.length >= 3 && quick.length / sl.length >= 0.4) || back.length >= 2) {
    const v = Math.min(2, Math.max(1, base.stopBuf * 2));
    if (v > base.stopBuf) { p.stopBuf = v; why.stopBuf = [quick.length >= 3 ? `${quick.length} of ${sl.length} stop-outs came within 45 min` : '', back.length >= 2 ? `${back.length} stopped trades went on to reach +1.5R anyway` : ''].filter(Boolean).join('; ') + '. The stop is sitting inside normal noise.'; }
  }
  // 8 · dead money
  const ts = T.filter(x => /time stop/.test(x.exitWhy || ''));
  if (ts.length >= 3 && Math.abs(rvMean(ts.map(x => x.R))) < 0.3) {
    const v = Math.max(4, Math.round(base.holdH * 0.67));
    if (v < base.holdH) { p.holdH = v; why.holdH = `${ts.length} trades sat until the ${base.holdH}h time stop and averaged ${fmtR(rvMean(ts.map(x => x.R)))}: dead money.`; }
  }
  // 9 · fees eating the wins
  if (OA.n >= 6 && gw > 0 && fees / gw >= 0.35) { p.volMul = 2; why.vol = `Fees were ${fmtMoney(fees)}, ${(fees / gw * 100).toFixed(0)}% of gross wins. Trade more liquid coins.`; }
  // 10 · longs bought in the run-up to an unlock (beyond the current guard window) keep losing → widen the window
  const lu = TA.filter(x => x.side === 'L' && x.unlK === 'ahead');
  if (lu.length >= 3 && rvMean(lu.map(x => x.R)) <= -0.4 && base.unlDays < 7) { p.unlDays = 7; why.unl = `${lu.length} longs opened with a big unlock less than 2 weeks away averaged ${fmtR(rvMean(lu.map(x => x.R)))}. Supply overhang hurts longs earlier than ${base.unlDays} days out.`; }
  // 12 · momentum: its own edge check
  const OM = rvAgg(TM);
  if (OM.n >= 5 && OM.avgR < -0.25) {
    p.mom = OM.n >= 8 && OM.avgR < -0.6 ? {score: 2, mul: 0.5} : {score: 1, mul: 0.75};
    why.mom = `Momentum trades averaged ${fmtR(OM.avgR)} over ${OM.n} trades, ${OM.win.toFixed(0)}% winners. Demand stronger moves and trade them smaller.`;
  }
  // 13 · your reviews: what you'd have done, and the points you disagreed with
  rvYourCalls(T, TM, p, why, base, st);
  // 11 · paying funding
  const fpaid = -TA.filter(x => (x.funding || 0) < 0).reduce((a, x) => a + x.funding, 0);
  if (OA.n >= 4 && gl > 0 && fpaid / gl >= 0.2) { p.fundGuard = true; why.fund = `Funding paid ${fmtMoney(fpaid)}, ${(fpaid / gl * 100).toFixed(0)}% of all losses.`; }
  // findings: strengths and weaknesses in plain words
  const F = [];
  F.push({t: OA.avgR >= 0 ? 'good' : 'bad', d: `${OA.n} trades: ${OA.win.toFixed(0)}% winners, average ${fmtR(OA.avgR)}, profit factor ${gl ? (gw / gl).toFixed(2) : '∞'}.`});
  const OMf = rvAgg(TM);
  if (O.n && OMf.n) F.push({t: 'info', d: `Reversal: ${O.n} trades, ${fmtR(O.avgR)} avg, ${O.win.toFixed(0)}% win · Momentum: ${OMf.n} trades, ${fmtR(OMf.avgR)} avg, ${OMf.win.toFixed(0)}% win.`});
  const rank = Object.entries(G.tag).filter(([, a]) => a.n >= 2).sort((a, b) => b[1].avgR - a[1].avgR);
  if (rank.length) F.push({t: rank[0][1].avgR >= 0 ? 'good' : 'bad', d: `Best setup: "${rank[0][0]}" (${rank[0][1].n} trades, ${fmtR(rank[0][1].avgR)}).`});
  if (rank.length > 1) F.push({t: rank[rank.length - 1][1].avgR < 0 ? 'bad' : 'good', d: `Weakest setup: "${rank[rank.length - 1][0]}" (${rank[rank.length - 1][1].n} trades, ${fmtR(rank[rank.length - 1][1].avgR)}).`});
  const su = TA.filter(x => x.side === 'S' && x.unlK === 'ahead');
  if (su.length >= 2) F.push({t: rvMean(su.map(x => x.R)) >= 0 ? 'good' : 'bad', d: `Shorts into an upcoming unlock: ${su.length} trades, avg ${fmtR(rvMean(su.map(x => x.R)))}.`});
  if (lu.length) F.push({t: rvMean(lu.map(x => x.R)) >= 0 ? 'good' : 'bad', d: `Longs with a big unlock ahead: ${lu.length} trades, avg ${fmtR(rvMean(lu.map(x => x.R)))}.`});
  if (gb.length) F.push({t: 'bad', d: `${gb.length} trade${gb.length > 1 ? 's were' : ' was'} +1R or better and ended flat or red.`});
  if (quick.length) F.push({t: 'bad', d: `${quick.length} stop-out${quick.length > 1 ? 's' : ''} within 45 minutes of entry.`});
  if (back.length) F.push({t: 'bad', d: `${back.length} stopped trade${back.length > 1 ? 's' : ''} later reached +1.5R. Right idea, wrong stop.`});
  if (fees) F.push({t: gw && fees / gw > 0.25 ? 'bad' : 'info', d: `Fees ${fmtMoney(fees)}, funding ${fmtMoney(fund, 1)} net.`});
  if (!Object.keys(why).length) F.push({t: 'good', d: O.n < 6 ? 'Sample is still small. No change is justified yet, so keep collecting trades.' : 'Nothing in the numbers says to change the rules. Keep executing.'});
  return {p, why, O: OA, pf: gl ? gw / gl : null, fees, fund, G, F};
}
/* ---- your opinion, as the Reviewer weighs it ---- */
// Your written comments come first. The Reviewer reads each comment (English or Cantonese/Chinese phrases) for what you'd
// have done, which of its points you think were wrong, and (SMC) which part of the setup you think was poor. A point taken
// from a comment counts 1; a chip you ticked without saying it in the comment counts ½. A "what I'd have done" becomes a
// rule change at 2 (two comments, or four chips) and at least a third of your reviews of that strategy, unless the trades
// clearly say otherwise. Disagreeing with a point at 1.5+ (and on at least half the trades where it came up) holds the rule
// change built on it. Your reading is shown under each comment, so you can check what the Reviewer understood.
const YOU_MIN = 2, YOU_DIS = 1.5;
const YOU_KEY_RULE = {forming: 'conf', quickstop: 'stopBuf', tight: 'stopBuf', giveback: 'tp1R', deadmoney: 'holdH', weak: 'score', never: 'score', costs: 'vol'};
// [pattern, what it means]. Matched in order; a matched phrase is blanked so "closed too early" isn't also read as "entered too early".
// a: what you'd have done · d: a Reviewer point you think was wrong · b: SMC part you think was poor (→ smc_<k>)
const YOU_PHRASES = [
  [/clos\w* too (early|soon)|exit\w* too (early|soon)|cut (it )?too (early|soon)|took (profit|it off) too (early|soon)|走得太早|太早(走|平倉|離場)|早咗走/, {a: 'hold'}],
  [/hold(ing)? (it )?(longer|more)|let (it|the winner|winners) run|should (have|'ve) held|揸(耐|長|多陣)|應該揸/, {a: 'hold'}],
  [/stop (was |is )?(fine|ok|okay|good|right|correct)|stop did its job|止蝕(冇問題|啱|正確|合理)/, {d: ['tight', 'quickstop']}],
  [/forming (was |is )?(fine|ok|good)|didn'?t need to wait|no need to wait (for (the )?confirm\w*)?|唔使等(確認)?/, {d: ['forming']}],
  [/(entered|entry|got in|in) too (early|soon)|too early|too soon|premature|jumped in|should (have|'ve) waited|wait(ed)? for (the )?(confirm\w*|reversed|a close|close)|太早(入|入場)?|等(埋|確認|佢確認|收)|心急/, {a: 'later'}],
  // wait for price to come back to a level (before the direction phrases, so "I would enter long when it reaches…" is read as "later", not as a side)
  [/(enter|entry|entered|buy|sell|long|short|get in)( it| long| short| a long| a short)? (only )?(when|once|after|if|until) (it |price |the price |the level |the candle )?(re)?(visits?|tests?|taps?|touch(es)?|reach(es)?|returns?( to)?|comes? back( to)?|pulls? back( to)?|retraces?( to)?|gets? (back )?to|drops? to|dips? to|rall(y|ies) to)|wait(ed)? for (a |the )?(retest|pullback|pull back|retrace\w*|dip)|wrong timing|bad timing|entry should (be|have been) (around|at|near|below|above|under|closer to) (the )?(stop|sweep|ob|order block|low|high|level|support|resistance)|等(佢)?(回調|回踩|回測|返到|跌返|升返|回落|回抽)|(回調|回踩|回測)先(入|買|沽)/, {a: 'later', b: ['depth']}],
  // which side you'd have traded: only "trade the other side" when the trade went the opposite way (needs the trade's side)
  [/(short|sell) instead of (a )?(long|buy(ing)?)|should (have |'ve )?(been |be )?(a )?short(ed)?\b|should (have |'ve )?(shorted|sold)|(would|will|i'd) (rather )?(do|take|enter|go|open|have done|have taken) (a |an )?short|(should|would) enter (a )?short|(應該|我會|會|要)(係)?(做|開|入)?(空|淡|short|沽)/, {flipTo: 'S'}],
  [/(long|buy) instead of (a )?(short|sell(ing)?)|should (have |'ve )?(been |be )?(a )?long(ed)?\b|should (have |'ve )?(longed|bought)|(would|will|i'd) (rather )?(do|take|enter|go|open|have done|have taken) (a |an )?long|(should|would) enter (a )?long|(應該|我會|會|要)(係)?(做|開|入)?(多|好倉|long)/, {flipTo: 'L'}],
  [/wrong (side|direction|way)|方向(錯|唔啱)|做錯方向/, {a: 'flip'}],
  // the higher timeframe's direction as you saw it: against the trade → poor; with it → fine
  [/(1 ?h(r|our)?|4 ?h(r|our)?|hourly|higher timeframe|htf|(whole |overall |previous |prior |main |bigger |big )?trend) (timeframe )?((was|is|still|are|,) )*(falling|dropping|down\w*|bearish)|(1h|4h|1小時|4小時|大級別|大時框|一小時|四小時|大趨勢|趨勢).{0,4}跌/, {htfDir: 'S'}],
  [/(1 ?h(r|our)?|4 ?h(r|our)?|hourly|higher timeframe|htf|(whole |overall |previous |prior |main |bigger |big )?trend) (timeframe )?((was|is|still|are|,) )*(rising|up(trend\w*|tred\w*|ward\w*)?\b|bullish)|(1h|4h|1小時|4小時|大級別|大時框|一小時|四小時|大趨勢|趨勢).{0,4}升/, {htfDir: 'L'}],
  [/right (trend|direction|side)/, {d: ['smc_htf']}],
  [/better (poi|point of interest|zone|level|area|(bu|be)?ob|order block)|(wrong|poor|bad|weak) (poi|point of interest|zone|area of interest)/, {b: ['poi']}],
  [/midpoint|mid point|50 ?%|equilibrium|deeper (in|into)|(entered|entry|in) at the (edge|top|bottom|first touch)|中位|一半|入深啲/, {a: 'later', b: ['depth']}],
  [/too late|entered late|late entry|chas(ed|ing)|missed the (move|entry)|太遲|追(咗|高|低|入)/, {a: 'earlier'}],
  [/(shouldn'?t|should not|wouldn'?t|would not) (have )?(take|taken|enter|entered|trade|traded|done)|no trade|not a (valid |real |good )?setup|bad setup|stay(ed)? out|skip|唔(應該|好)?(入|做|開)|冇setup|不該/, {a: 'skip'}],
  [/(take|took|bank|banked) (profit|half|it) (earlier|sooner)|should (have|'ve) (taken profit|banked|closed|exited)|exit(ed)? (earlier|sooner)|gave (it |the profit |profit )?back|早啲(走|平倉|食糊|鎖利)|應該(走|平倉|食糊)|蝕返/, {a: 'exitE'}],
  [/stop (was |is )?(too )?(tight|close|near)|wider stop|stop (inside|in) the noise|wick(ed)? (me |it )?out|stopped (out )?by a wick|stop hunt\w*|止蝕太(近|窄|緊)|洗(咗)?(出|走)|俾人洗/, {a: 'wider'}],
  [/stop (was |is )?(too )?(wide|far|loose)|tighter stop|止蝕太(遠|闊|鬆)/, {a: 'tighter'}],
  [/(too )?(big|large|heavy) (size|position)|size (was )?(too big|too large)|smaller size|(reduce|cut|lower) (the )?size|太大注|細(注|倉)|落少啲/, {a: 'smaller'}],
  [/bigger size|size up|(should|could) (have )?sized up|size (was )?too small|大注啲|落多啲/, {a: 'bigger'}],
  [/against (the )?(1 ?hr?|4 ?hr?|1 hour|4 hour|higher|htf|bigger|main) ?(tf|timeframe|trend|structure)?|htf (was |is )?against|逆(大)?(勢|趨勢)/, {b: ['htf']}],
  [/(weak|bad|poor|no|not a( good| real)?|ugly|messy) ((bu|be)?ob|order block)|((bu|be)?ob|order block) (was |is )?(weak|bad|poor|not good|messy)|ob(唔好|麻麻|差|唔靚)/, {b: ['ob']}],
  [/(small|tiny|weak|bad|poor) (fvg|gap|imbalance)|(fvg|gap) (was |is )?(too )?(small|tiny|weak|bad|poor)|(no|weak) displacement|fvg(太細|唔好|麻麻|差)/, {b: ['gap']}],
  [/(no|not at a|not from a|missing) (htf |higher timeframe |1h |4h )?(poi|point of interest|zone|demand|supply|key level)|middle of (the )?(range|nowhere)|not at (any|a) (htf |1h |4h )?(level|zone)|冇(大級別)?(支撐|阻力|zone)/, {b: ['poi']}],
  [/(no|don'?t|do not|stop|skip) (trade |trading |take |taking )?(the )?continuation|continuation (setups? )?(are|is|was) (bad|weak|not good)|chas(ed|ing) the trend|唔好(做|追)順勢/, {b: ['cont']}],
  [/against (the )?(draw|dol)|wrong (side of the )?draw|逆(住)?draw/, {b: ['draw']}],
  [/with (the )?(draw|dol)|(took|swept|ran) (the )?(previous|prior) day'?s? (low|high)|(pdl|pdh) (sweep|swept|taken)/, {d: ['smc_draw']}],
  [/low[ -]resistance|failure swings? (above|below|in the way|to the target)|clean path/, {d: ['smc_path']}],
  [/high[ -]resistance (high|low|liquidity|swing)|(stalled|struggled) at (the |a )?(high|low|swing)/, {b: ['room']}],
  [/(ran|ran straight|bought|sold|longed|shorted) into (a |the )?(supply|demand|resistance|support)|no room|target (was )?(behind|past|beyond) (a |the )?(supply|demand|zone)|頂住阻力|撞阻力/, {b: ['room']}],
  [/(no|weak|fake|not a (real|clean)) (sweep|liquidity grab|grab)|sweep (was |is )?(weak|small|not clean)|didn'?t (sweep|take|grab) (the )?liquidity|冇(掃|洗)(到)?流動性/, {b: ['sweep']}],
  [/(good|clean|nice|valid|strong) (fvg|gap|imbalance)|(fvg|gap) (was |is )?(good|clean|nice|fine)|靚(嘅)?fvg/, {d: ['smc_gap']}],
  [/(good|clean|nice|valid|strong) (ob|order block)|(ob|order block) (was |is )?(good|clean|nice|fine)|靚(嘅)?ob/, {d: ['smc_ob']}],
  [/(good|right|valid|nice) (htf |1h |4h )?(poi|zone|level)|(from|at) (the |a )?(htf|1h|4h) (demand|supply|zone)/, {d: ['smc_poi']}],
  [/(htf|higher timeframe|1h|4h) (was |is )?(fine|ok|with (me|it|us))|with the (htf|higher timeframe|trend)|順勢/, {d: ['smc_htf']}],
  [/good trade|fine trade|classic (short |long |reversal |continuation )?(setup|trade|pattern)|nothing wrong|would (have )?(done|taken|take) the same|same trade|冇問題|做得好|正確/, {a: 'same'}]];
function youRead(note, side) {
  let t = ' ' + String(note || '').toLowerCase().replace(/[’']/g, "'") + ' ';
  const a = new Set(), d = new Set(), b = new Set(), hits = [];
  for (const [re, m] of YOU_PHRASES) {
    const g = new RegExp(re.source, 'g'); let x;
    while ((x = g.exec(t))) {
      const pre = t.slice(Math.max(0, x.index - 10), x.index);
      if (!/\b(not|no|never|didn'?t|don'?t|wasn'?t)\s+(\w+\s+)?$|唔$|不$|冇$/.test(pre) || /^(no|not|唔|冇|不)/.test(x[0])) {
        if (m.a) a.add(m.a); for (const k of m.d || []) d.add(k); for (const k of m.b || []) b.add(k);
        if (m.flipTo && side && m.flipTo !== side) a.add('flip');                              // you'd have traded the other side
        if (m.htfDir) { if (!side || m.htfDir !== side) b.add('htf'); else d.add('smc_htf'); } // the trend as you saw it vs the trade
        hits.push(x[0].trim());
      }
      t = t.slice(0, x.index) + ' '.repeat(x[0].length) + t.slice(x.index + x[0].length); g.lastIndex = x.index + x[0].length;
    }
  }
  if (a.size > 1) a.delete('same');
  return {a: [...a], d: [...d], b: [...b], hits, any: a.size + d.size + b.size > 0};
}
// A review as the Reviewer takes it. If Claude has read this review (comment + chart pictures) in a chat and left a reading
// (m.rd, saved with the review), that reading is used instead of the phrase reader, as long as the text hasn't changed since.
// Your marks on the chart (m.plan, drawn on the Reviewer's "On the chart" tab), compared with the trade, count like a comment.
function youReadM(m, side, x) {
  const txt = mineText(m), c = youRead(txt, side), rd = m && m.rd;
  if (rd && rd.n === txt.length) { c.a = [...(rd.a || [])]; c.b = [...(rd.b || [])]; c.d = [...(rd.d || [])]; c.any = c.a.length + c.b.length + c.d.length > 0; c.rd = rd; }
  const pp = planPoints(m && m.plan, x);
  for (const k of ['a', 'b', 'd']) for (const v of pp[k]) if (!c[k].includes(v)) c[k].push(v);
  if (pp.a.length + pp.b.length + pp.d.length) { c.any = true; c.plan = pp; if (c.a.length > 1) c.a = c.a.filter(v => v !== 'same'); }
  return c;
}
// what your marked setup says, measured against the trade (in units of the trade's own risk):
//   other side → "trade the other side" · same side, entry ≥ 0.25R deeper → "enter later" + edge entry
//   (same entry) stop ≥ 0.2R further out / in → "wider" / "tighter stop" · target ≥ 30% short of / 40% past the trade's → "exit earlier" / "hold longer"
function planPoints(P, x) {
  const o = {a: [], b: [], d: []}; if (!P || !x || !P.entry || !fin(P.entry.p)) return o;
  const side = P.side || x.side; if (side !== x.side) { o.a.push('flip'); return o; }
  const L = side === 'L', sg = L ? 1 : -1, d = Math.abs(x.entry - x.stop0) || x.entry * 0.01, en = P.entry.p;
  const deeper = (x.entry - en) * sg >= 0.25 * d;
  if (deeper) { o.a.push('later'); o.b.push('depth'); }
  else if (fin(P.stop)) { const out = (x.stop0 - P.stop) * sg; if (out >= 0.2 * d) o.a.push('wider'); else if (out <= -0.2 * d && (en - P.stop) * sg > 0) o.a.push('tighter'); }
  const bt = x.strat === 'smc' ? x.target : x.entry + sg * (x.tpR || (typeof PT !== 'undefined' ? PT.cfg.tpR : 3)) * d, span = fin(bt) ? Math.abs(bt - x.entry) : 0;
  if (fin(P.target) && span) { const q = (P.target - bt) * sg / span; if (q <= -0.3) o.a.push('exitE'); else if (q >= 0.4) o.a.push('hold'); }
  return o;
}
// plain-language reading of a comment, for the form and the review wall
const YOU_B_TXT = {draw: 'against the draw on liquidity', cont: 'skip continuation setups', poi: 'not at a higher-timeframe zone', room: 'ran into an opposing zone', htf: 'traded against the higher timeframe', ob: 'the order block was poor', gap: 'the FVG was poor', sweep: 'the sweep was weak', depth: 'entered at the zone\'s edge'};
const YOU_D_TXT = {tight: 'the stop was fine', quickstop: 'the stop was fine', forming: 'entering at "forming" was fine', smc_gap: 'the FVG was good', smc_ob: 'the order block was good', smc_htf: 'the higher timeframe was fine', smc_poi: 'it was at a good zone', smc_path: 'the path to the target was low-resistance', smc_draw: 'it was with the draw'};
const YOU_A_TXT = {flip: 'trade the other side', same: 'same trade', skip: 'skip it', later: 'enter later', earlier: 'enter earlier', exitE: 'exit earlier', hold: 'hold longer', wider: 'wider stop', tighter: 'tighter stop', bigger: 'bigger size', smaller: 'smaller size'};
// everything you wrote on a review: the comment plus the caption under each chart picture
const mineText = m => [m && m.note, ...((m && m.imgs) || []).map(i => i && i.cap)].filter(s => String(s || '').trim()).join('. ');
function youReadTxt(c) {
  if (!c || !c.any) return '';
  return [...c.a.map(k => YOU_A_TXT[k]), ...[...new Set(c.d.map(k => YOU_D_TXT[k]))], ...c.b.map(k => YOU_B_TXT[k])].filter(Boolean).join(' · ');
}
function youTally(L) {
  const R = L.map(x => [x, mineOf(x)]).filter(([, m]) => m && !m.excl), alt = {}, dis = {}, disN = {}, seen = {}, bad = {}, cm = {}, ch = {}, q = {};
  const put = (o, k, w) => { o[k] = (o[k] || 0) + w; };
  let nc = 0;
  let den = 0;                                       // reviews that carry an opinion (a reading, a chip, or a disputed point)
  for (const [x, m] of R) {
    const c = youReadM(m, x.side, x), quote = String(c.rd && c.rd.txt ? c.rd.txt : mineText(m)).trim().replace(/\s+/g, ' ');
    if (c.any) nc++;
    if (c.any || (m.alt || []).length || (m.xk || []).length) den++;
    const A = new Set(c.a), D = new Set(c.d);
    // comment = 1, chip not said in the comment = ½
    for (const k of A) { put(alt, k, 1); put(cm, k, 1); q[k] = q[k] || quote; }
    for (const k of m.alt || []) if (!A.has(k)) { put(alt, k, 0.5); put(ch, k, 1); }
    for (const k of D) { put(dis, k, 1); put(disN, k, 1); put(seen, k, 1); q['d:' + k] = q['d:' + k] || quote; }
    for (const k of m.xk || []) if (!D.has(k)) { put(dis, k, 0.5); put(disN, k, 1); }
    for (const k of m.ik || []) if (!D.has(k)) put(seen, k, 1);
    for (const k of c.b) { put(bad, k, 1); q['b:' + k] = q['b:' + k] || quote; }
  }
  const short = s => s.length > 70 ? s.slice(0, 67) + '…' : s;
  // where a point came from, in words: your comments first
  const src = (k, chipLab) => {
    const c = cm[k] || 0, h = ch[k] || 0, parts = [];
    if (c) parts.push(`your comment${c > 1 ? 's' : ''} on ${c} trade${c > 1 ? 's' : ''} ("${short(q[k])}")`);
    if (h) parts.push(`"${chipLab}" ticked on ${h} more`);
    return 'From ' + parts.join(' and ') + '.';
  };
  return {n: R.length, nc, alt, dis, seen, bad, q, src,
    // a point counts once it reaches 2 and a third of your reviews that say anything; from 3 it counts regardless
    says: a => (alt[a] || 0) >= YOU_MIN && ((alt[a] || 0) >= 3 || (alt[a] || 0) >= den / 3),
    flags: k => (bad[k] || 0) >= YOU_MIN && ((bad[k] || 0) >= 3 || (bad[k] || 0) >= den / 3),
    rejects: k => (dis[k] || 0) >= YOU_DIS && (dis[k] || 0) >= (seen[k] || dis[k]) / 2,
    disTxt: k => q['d:' + k] ? `you disagreed with that point, e.g. "${short(q['d:' + k])}"` : `you disagreed with that point on ${disN[k] || 0} trades`};
}
function rvYourCalls(T, TM, p, why, base, st) {
  const Y = youTally(T), YM = youTally(TM), tag = (k, a) => Y.src(k, a);
  if (Y.n) {
    // points you keep disagreeing with: hold the change that rests on them
    for (const k in YOU_KEY_RULE) if (Y.rejects(k)) {
      const r = YOU_KEY_RULE[k]; if (['conf', 'stopBuf', 'tp1R', 'holdH', 'vol'].includes(r)) RV_HELD.push(r);   // also stops the sticky logic keeping it
      if (r === 'conf' && p.needConf) { p.needConf = false; why.youHold = (why.youHold ? why.youHold + ' ' : '') + `Held "enter only at Reversed": ${Y.disTxt(k)}.`; }
      if (r === 'stopBuf' && p.stopBuf) { delete p.stopBuf; why.youHold = (why.youHold ? why.youHold + ' ' : '') + `Held the wider stop: ${Y.disTxt(k)}.`; }
      if (r === 'tp1R' && p.tp1R) { delete p.tp1R; why.youHold = (why.youHold ? why.youHold + ' ' : '') + `Held the earlier partial: ${Y.disTxt(k)}.`; }
      if (r === 'holdH' && p.holdH) { delete p.holdH; why.youHold = (why.youHold ? why.youHold + ' ' : '') + `Held the shorter hold: ${Y.disTxt(k)}.`; }
      if (r === 'score' && p.score && !why.youScore) { p.score = Math.max(0, p.score - 1); if (!p.score) p.riskMul = 1; why.youHold = (why.youHold ? why.youHold + ' ' : '') + `Eased the extra-signs rule: ${Y.disTxt(k)}.`; }
      if (r === 'vol' && p.volMul !== 1) { p.volMul = 1; why.youHold = (why.youHold ? why.youHold + ' ' : '') + `Held the volume rule: ${Y.disTxt(k)}.`; }
    }
    // what you'd have done, unless the trades clearly disagree
    const fo = st.rev, dn = st.done;
    if (Y.says('later') && !p.needConf && !(dn && fo && dn.n >= 3 && fo.n >= 3 && dn.avgR < fo.avgR - 0.3)) { p.needConf = true; why.conf = tag('later', 'enter later') + ' Enter only once the reversal is confirmed.'; }
    if ((Y.says('skip') || Y.says('flip')) && !p.score) { const k = Y.says('skip') ? 'skip' : 'flip'; p.score = 1; why.score = tag(k, YOU_A_TXT[k]) + ' Be pickier: one more sign.'; why.youScore = 1; }
    if (Y.says('exitE') && !p.tp1R && base.tp1R > 1.2) { p.tp1R = 1.2; why.tp1R = tag('exitE', 'exit earlier') + ' Bank half sooner.'; }
    if (Y.says('hold') && !p.holdH) { p.holdH = Math.min(24, Math.round(base.holdH * 1.5)); why.holdH = tag('hold', 'hold longer') + ' Give trades more time.'; }
    if (Y.says('wider') && !p.stopBuf) { p.stopBuf = Math.min(2, Math.max(1, base.stopBuf * 2)); why.stopBuf = tag('wider', 'wider stop'); }
    else if (Y.says('tighter') && !p.stopBuf && base.stopBuf > 0.25) { p.stopBuf = Math.max(0.25, base.stopBuf / 2); why.stopBuf = tag('tighter', 'tighter stop'); }
    if (Y.says('smaller') && p.riskMul > 0.75) { p.riskMul = 0.75; why.risk = tag('smaller', 'smaller size'); }
  }
  if (YM.n) {
    const sk = YM.says('skip') ? 'skip' : YM.says('later') ? 'later' : null;
    if (sk) { p.mom = p.mom || {score: 0, mul: 1}; if (!p.mom.score) { p.mom.score = 1; why.mom = `Momentum: ${YM.src(sk, YOU_A_TXT[sk])} Demand one more momentum sign.`; } }
    if (YM.says('smaller')) { p.mom = p.mom || {score: 0, mul: 1}; if (p.mom.mul > 0.75) { p.mom.mul = 0.75; why.mom = (why.mom ? why.mom + ' ' : '') + `Momentum size: ${YM.src('smaller', 'smaller size')}`; } }
  }
}
/* ---- the SMC Trader's own review, in SMC terms ---- */
// Factors from each trade's quality audit (sweep, liquidity, structure break, FVG / OB, premium/discount, higher timeframe,
// entry depth), its entry timeframe and its quality grade. A change needs 5+ trades on each side and a 0.5R+ gap with the
// better side making money; your SMC reviews count the same way as for the Trader. RV.smAdj is what the SMC Trader applies.
const SM_FACTOR = {sweep: 'Sweep', liq: 'Liquidity taken', mss: 'Structure break', gap: 'FVG size', disp: 'FVG displacement', ob: 'Order block', obliq: 'OB took the liquidity', pd: 'Premium / discount', htf: 'Higher timeframe', depth: 'Entry depth in the zone', dep: 'Departure from the zone', poi: 'Higher-timeframe zone (POI)', trend: 'Trend (continuation)', path: 'Path to target (failure swings)', draw: 'Higher-timeframe draw on liquidity', pday: 'Previous day high/low', mit: 'Mitigation block', cycle: 'Market cycle (expansion / AMD)', bg: 'Breakaway gap', prot: 'Stop behind a high-resistance swing', room: 'Room to the target', conf: '15m confirmation', c2: 'Candle confirmation (C2 / C3)', open: 'Higher-timeframe candle open (manipulation leg)'};
function smStudy(L) {
  const T = L.filter(x => x.q && x.q.items && !rvManual(x)), F = {};
  for (const k in SM_FACTOR) {
    const G = T.filter(x => x.q.items.some(i => i.k === k && i.ok === 2)), N = T.filter(x => x.q.items.some(i => i.k === k && i.ok < 2));
    if (G.length || N.length) F[k] = {good: rvAgg(G), rest: rvAgg(N), poor: rvAgg(T.filter(x => x.q.items.some(i => i.k === k && i.ok === 0)))};
  }
  return {n: T.length, F, type: rvGroup(T, x => x.type || 'rev'), tf: rvGroup(T, x => x.tf || '15m'), kind: rvGroup(T, x => x.zoneKind || null), grade: rvGroup(T, x => x.q.grade), htf: rvGroup(T, x => { const i = x.q.items.find(i => i.k === 'htf'); return i ? (i.ok === 2 ? 'agrees' : i.ok === 1 ? 'unclear' : 'against') : null; }),
    // Nov 12: HTF regime play (rows before the regime gate show as ?), stop distance and planned RR
    play: rvGroup(T, x => x.play || '?'), regime: rvGroup(T, x => x.regime || '?'),
    stopPct: rvGroup(T, x => { const d = Math.abs(x.entry - x.stop0) / x.entry * 100; return !fin(d) ? null : d < 2 ? '<2%' : d <= 4 ? '2–4%' : '>4%'; }),
    rr: rvGroup(T, x => !fin(x.rr) ? null : x.rr < 2.5 ? '<2.5' : x.rr <= 3.5 ? '2.5–3.5' : '>3.5')};
}
/* ---- zone choice (Nov 13, Fred: "佢自己再調"): from the labelled candidate zones of past trades (smZoneBackfill), which kind of
   FVG / OB turned out right. Same gate as the other rules: each side 5+ zones, 0.5R apart, the better side above 0. r per zone:
   right = the R it reached (≤ 3), wrong = −1 (0 if it just went nowhere). Untouched zones are left out. */
const SMZ_F = {fvg: ['FVGs (vs order blocks)', z => z.kind === 'FVG'], fresh: ['fresh zones (untouched since they formed)', z => !!z.fresh],
  pos: ['the newest zone on the leg', z => !!z.last], pd: ['zones in the discount / premium half of the leg', z => !!z.pd],
  ovl: ['zones overlapping the other kind (FVG inside the OB)', z => !!z.ovl], big: ['zones of 0.3 ATR or more', z => z.zs >= 0.3]};
function smZoneTune(rows) {
  const C = [];
  for (const x of rows || []) { const c = x && x.zc && x.zc.c; if (!c || !c.length) continue; const top = Math.max(...c.map(z => z.pos));
    for (const z of c) if (z.lab === 'right' || z.lab === 'wrong') C.push(Object.assign({}, z, {last: z.pos === top})); }
  const W = {}, why = [], agg = A => ({n: A.length, r: rvMean(A.map(z => z.r))}), ok = (a, b) => a.n >= 5 && b.n >= 5 && a.r - b.r >= 0.5 && a.r > 0;
  for (const k in SMZ_F) {
    const f = SMZ_F[k][1], a = agg(C.filter(f)), b = agg(C.filter(z => !f(z))), w = Math.round(1000 * Math.abs(a.r - b.r));   // ≥ 500: outweighs the default FVG-first, newest-first order
    if (ok(a, b)) { if (k === 'big') W.minZs = 0.3; else W[k] = w; } else if (ok(b, a)) W[k] = -w; else continue;
    why.push({k, n1: a.n, n2: b.n, r1: +a.r.toFixed(3), r2: +b.r.toFixed(3)});
  }
  return why.length ? {W: Object.assign({}, SMZ_DEF, W), why} : null;
}
function smLearn() {
  const L = SM.log, St = smStudy(L), A = {}, W = {}, ok = (a, b) => a.n >= 5 && b.n >= 5 && a.avgR - b.avgR >= 0.5 && a.avgR > 0;
  const h = St.htf; if (h.agrees && h.unclear && ok(h.agrees, h.unclear)) { A.needHTF = true; W.needHTF = `Higher timeframe agreeing: ${h.agrees.n} trades, ${fmtR(h.agrees.avgR)}; unclear: ${h.unclear.n}, ${fmtR(h.unclear.avgR)}. Only trade with the higher timeframe.`; }
  const fd = St.F.draw; if (fd && fd.good && fd.rest && ok(fd.good, fd.rest)) { A.needDraw = true; W.needDraw = `With the higher-timeframe draw on liquidity: ${fd.good.n} trades, ${fmtR(fd.good.avgR)}; against it: ${fd.rest.n}, ${fmtR(fd.rest.avgR)}. Only trade with the draw.`; }
  const fp = St.F.poi; if (fp && fp.good && fp.rest && ok(fp.good, fp.rest)) { A.needPOI = true; W.needPOI = `Sweeps into a fresh higher-timeframe zone: ${fp.good.n} trades, ${fmtR(fp.good.avgR)}; elsewhere: ${fp.rest.n}, ${fmtR(fp.rest.avgR)}. Only trade from a higher-timeframe zone or swing.`; }
  const ty = St.type; if (ty.rev && ty.cont && ok(ty.rev, ty.cont)) { A.noCont = true; W.noCont = `Continuation setups ${fmtR(ty.cont.avgR)} over ${ty.cont.n} trades vs reversals ${fmtR(ty.rev.avgR)} over ${ty.rev.n}. Pause continuation setups.`; }
  const kd = St.kind; if (kd.FVG && kd.OB && ok(kd.FVG, kd.OB)) { A.fvgOnly = true; W.fvgOnly = `FVG entries ${fmtR(kd.FVG.avgR)} (${kd.FVG.n}) vs order blocks ${fmtR(kd.OB.avgR)} (${kd.OB.n}). FVGs only.`; }
  const hiQ = rvAgg(L.filter(x => x.q && !rvManual(x) && x.q.score >= 70)), loQ = rvAgg(L.filter(x => x.q && !rvManual(x) && x.q.score < 70));
  if (ok(hiQ, loQ)) { A.minQ = 70; W.minQ = `Quality B or better: ${hiQ.n} trades, ${fmtR(hiQ.avgR)}; below B: ${loQ.n}, ${fmtR(loQ.avgR)}. Raise the bar to 70/100.`; }
  const t = St.tf; if (t['15m'] && t['1h']) { if (ok(t['1h'], t['15m'])) { A.noTf = '15m'; W.noTf = `1h setups ${fmtR(t['1h'].avgR)} (${t['1h'].n}) vs 15m ${fmtR(t['15m'].avgR)} (${t['15m'].n}). Pause 15m setups.`; } else if (ok(t['15m'], t['1h'])) { A.noTf = '1h'; W.noTf = `15m setups ${fmtR(t['15m'].avgR)} (${t['15m'].n}) vs 1h ${fmtR(t['1h'].avgR)} (${t['1h'].n}). Pause 1h setups.`; } }
  const d = St.F.depth; if (d && ok(d.good, d.rest)) { A.needDepth = true; W.needDepth = `Entries at the zone's midpoint or deeper: ${fmtR(d.good.avgR)} (${d.good.n}) vs at the edge: ${fmtR(d.rest.avgR)} (${d.rest.n}). Wait for the midpoint.`; }
  const zt = smZoneTune(L.filter(x => !rvManual(x)));
  if (zt) { A.zone = zt.W; W.zone = 'Zone choice from labelled zones: ' + zt.why.map(w => `${SMZ_F[w.k][0]} ${fmtR(w.r1)} (${w.n1}) vs the rest ${fmtR(w.r2)} (${w.n2})`).join('; ') + '. The pick now weighs these.'; }
  // your SMC reviews: your comments first (what you'd have done, and which part of the setup you think was poor)
  const Y = youTally(L.slice(0, 40));   // your last 40 reviewed SMC trades
  if (Y.says('flip') && !A.needHTF) { A.needHTF = true; W.needHTF = `${Y.src('flip', 'trade the other side')} Only trade when the higher timeframe clearly agrees.`; }
  if (Y.flags('draw') && !A.needDraw) { A.needDraw = true; W.needDraw = `Your comments: against the draw on liquidity on ${Y.bad.draw} trades ("${String(Y.q['b:draw']).slice(0, 70)}"). Only trade with the higher-timeframe draw.`; }
  if (Y.flags('cont') && !A.noCont) { A.noCont = true; W.noCont = `Your comments: continuation trades you'd skip on ${Y.bad.cont} trades ("${String(Y.q['b:cont']).slice(0, 70)}"). Pause continuation setups.`; }
  if (Y.flags('poi') && !A.needPOI) { A.needPOI = true; W.needPOI = `Your comments: not at a higher-timeframe zone on ${Y.bad.poi} trades ("${String(Y.q['b:poi']).slice(0, 70)}"). Only trade from a higher-timeframe zone or swing.`; }
  if (Y.flags('room') && !A.minQ) { A.minQ = Math.min(85, SM.cfg.minQ + 10); W.minQ = `Your comments: ran into an opposing zone on ${Y.bad.room} trades ("${String(Y.q['b:room']).slice(0, 70)}"). Raise the quality bar to ${A.minQ}/100.`; }
  if (Y.flags('htf') && !A.needHTF) { A.needHTF = true; W.needHTF = `Your comments: traded against the higher timeframe on ${Y.bad.htf} trades ("${String(Y.q['b:htf']).slice(0, 70)}"). Only trade when the higher timeframe agrees.`; }
  if (Y.flags('ob') && !A.fvgOnly) { A.fvgOnly = true; W.fvgOnly = `Your comments: the order block was poor on ${Y.bad.ob} trades ("${String(Y.q['b:ob']).slice(0, 70)}"). FVG entries only.`; }
  if ((Y.flags('gap') || Y.flags('sweep')) && !A.minQ) { const k = Y.flags('gap') ? 'gap' : 'sweep'; A.minQ = Math.min(85, SM.cfg.minQ + 10); W.minQ = `Your comments: ${k === 'gap' ? 'a poor FVG' : 'a weak sweep'} on ${Y.bad[k]} trades ("${String(Y.q['b:' + k]).slice(0, 70)}"). Raise the quality bar to ${A.minQ}/100.`; }
  if ((Y.flags('depth') || Y.says('later')) && !A.needDepth) { A.needDepth = true; W.needDepth = (Y.says('later') ? Y.src('later', 'enter later') : `Your comments on ${Y.bad.depth} trades ("${String(Y.q['b:depth']).slice(0, 70)}").`) + ' Wait for the zone\'s midpoint.'; }
  if (Y.says('skip') && !A.minQ) { A.minQ = Math.min(85, SM.cfg.minQ + 10); W.minQ = `${Y.src('skip', 'skip it')} Raise the quality bar to ${A.minQ}/100.`; }
  if (Y.says('wider')) { A.stopBuf = Math.min(1.5, SM.cfg.stopBuf * 2); W.stopBuf = `${Y.src('wider', 'wider stop')} Stop further beyond the sweep.`; }
  if (Y.says('exitE') && SM.cfg.tp1R > 1.2) { A.tp1R = 1.2; W.tp1R = `${Y.src('exitE', 'exit earlier')} Bank half at +1.2R.`; }
  if (Y.says('smaller')) { A.riskMul = 0.75; W.riskMul = `${Y.src('smaller', 'smaller size')} Size ×0.75.`; }
  const youHeld = new Set();
  for (const k of ['htf', 'depth', 'gap', 'ob', 'poi', 'draw']) if (Y.rejects('smc_' + k)) {
    const m = {htf: 'needHTF', depth: 'needDepth', gap: 'minQ', ob: 'fvgOnly', poi: 'needPOI', draw: 'needDraw'}[k];
    if (A[m]) { delete A[m]; W.youHold = (W.youHold ? W.youHold + ' ' : '') + `Held "${SM_FACTOR[k]}" rule: ${Y.disTxt('smc_' + k)}.`; }
    youHeld.add(m);
  }
  // tell the SMC Trader what changed
  // coaching findings with enough trades behind them become rules too (see smCoach)
  const CO = smCoach(L);
  for (const c of CO.recs) if (c.solid && c.rule && !(c.rule in A)) { if (c.rule === 'tp1R') A.tp1R = 1.2; else if (c.rule === 'stopBuf') A.stopBuf = Math.min(1.5, SM.cfg.stopBuf * 2); else if (c.rule === 'minQ') A.minQ = Math.min(85, SM.cfg.minQ + 10); else A[c.rule] = true; W[c.rule] = 'Coaching: ' + c.txt; }
  // rules stay until the trades say otherwise (they used to drop out and come back within hours):
  // a rule in force is kept until 6+ SMC trades closed since it last had support average ≥ 0, or 5 days pass; your disagreement lifts it at once
  { const old0 = RV.smAdj || {}, SS = RV.smSticky = RV.smSticky || {}, Ln = L.filter(x => !rvManual(x));
    for (const k in old0) {
      const st = SS[k] || (SS[k] = {last: now(), why: (RV.smWhy || {})[k] || ''}), newer = Ln.filter(x => x.t1 > st.last);
      const release = youHeld.has(k) || now() - st.last > RV_STICKY_MAX || (newer.length >= 6 && rvMean(newer.map(x => x.R)) >= 0);
      if (release) continue;
      if (!(k in A)) { A[k] = old0[k]; W[k] = `${st.why || W[k] || ''} (Kept: ${newer.length} SMC trade${newer.length === 1 ? '' : 's'} since, ${newer.length ? fmtR(rvMean(newer.map(x => x.R))) : 'none yet'}; no opposite evidence.)`.trim(); }
      else if (k === 'minQ' && old0.minQ > A.minQ) A.minQ = old0.minQ;
    }
    for (const k in A) if (!(k in old0) || !SS[k] || W[k] && !/\(Kept:/.test(W[k])) SS[k] = {last: now(), why: W[k] || ''};
    for (const k in SS) if (!(k in A)) delete SS[k]; }
  const lab = {needDraw: 'Only trade with the higher-timeframe draw on liquidity', needPOI: 'Only trade from a higher-timeframe zone or swing', noCont: 'Pause continuation setups', needHTF: 'Only trade when the higher timeframe agrees', fvgOnly: 'FVG entries only (no order blocks)', minQ: `Minimum setup quality ${A.minQ}/100`, noTf: `Pause ${A.noTf} setups`, needDepth: 'Enter at the zone\'s midpoint or deeper', stopBuf: `Stop ${A.stopBuf}% beyond the sweep`, tp1R: `Half at +${A.tp1R}R`, riskMul: `Size ×${A.riskMul}`, zone: 'Zone choice tuned from labelled zones'};
  const old = RV.smAdj || {}, key = o => JSON.stringify(o);
  if (key(old) !== key(A)) {
    for (const k in A) if (key(A[k]) !== key(old[k])) { rvMemo('rev', 'smc', `SMC review: ${lab[k] || k}. ${W[k] || ''}`); rvMemo('smc', 'rev', SM.cfg.learn ? `Applied: ${String(lab[k] || k).charAt(0).toLowerCase() + String(lab[k] || k).slice(1)}.` : 'Noted, but learning from SMC reviews is switched off on my desk.'); }
    for (const k in old) if (!(k in A)) { rvMemo('rev', 'smc', `SMC review: lift "${lab[k] || k}". ${youHeld.has(k) ? 'You disagreed with the point it rests on.' : 'The SMC trades since it was set came out fine, or it was due a re-test.'}`); rvMemo('smc', 'rev', 'Lifted.'); }
  }
  RV.smAdj = A; RV.smWhy = W; RV.smStudyN = St.n;
  smCoachTalk(CO);
}
/* ---- coaching: the Reviewer judges the SMC Trader's skill in three areas, from its closed trades ----
   Zones (OB & FVG): did the zone hold? Which kinds of zones held? Liquidity: was real liquidity swept, and did price get to
   the target liquidity? Execution: stops run then right, profit given back, exits before the move. Each finding carries the
   setting it would change; with enough trades (solid) it becomes a rule, before that it's a note the SMC Trader keeps in mind. */
function smOutcome(x) {
  const R = x.R, mx = Math.max(x.maxR || 0, R), rr = fin(x.rr) && x.rr > 0 ? x.rr : null, af = x.fu && x.fu.af ? x.fu.af.v : null;
  return {held: mx >= 1 || R >= 0.5, failed: R <= -0.8 && mx < 0.5, reached: /target/.test(x.exitWhy || '') || !!(rr && mx >= rr * 0.95),
    frac: rr ? Math.min(1, Math.max(0, mx / rr)) : null, after: af === 'early' || af === 'left', tight: af === 'tight',
    quick: /stop loss/.test(x.exitWhy || '') && x.t1 - x.t0 < 45 * 60e3, gave: mx >= 1 && R < 0.2};
}
const smQk = (x, k) => { const i = x.q && x.q.items && x.q.items.find(i => i.k === k); return i ? i.ok : null; };
const COACH_GR = v => v == null ? '—' : v >= 0.75 ? 'A' : v >= 0.6 ? 'B' : v >= 0.45 ? 'C' : v >= 0.3 ? 'D' : 'F';
function smCoach(L) {
  const T = L.filter(x => !rvManual(x)), O = new Map(T.map(x => [x, smOutcome(x)])), n = T.length;
  const hr = A => { const h = A.filter(x => O.get(x).held).length, f = A.filter(x => O.get(x).failed).length; return {n: A.length, h, f, rate: h + f ? h / (h + f) : null}; };
  const avg = A => A.length ? A.reduce((a, x) => a + x.R, 0) / A.length : null;
  const split = (k, A = T) => ({good: A.filter(x => smQk(x, k) === 2), rest: A.filter(x => smQk(x, k) != null && smQk(x, k) < 2)});
  const recs = [], strengths = { zone: [], liq: [], exec: [] }, work = { zone: [], liq: [], exec: [] };
  const rec = (area, txt, rule, a, b) => { const solid = b == null ? a >= 8 : Math.min(a, b) >= 5; recs.push({area, txt, rule, solid, n: a + (b || 0)}); work[area].push(txt); };
  const pct = (a, b) => `${a}/${b}`;
  // ---- zones: OB & FVG
  const F = T.filter(x => (x.zoneKind || (x.zone || {}).kind) === 'FVG'), OBs = T.filter(x => (x.zoneKind || (x.zone || {}).kind) === 'OB'), all = hr(T), hf = hr(F), ho = hr(OBs);
  if (all.h + all.f >= 3) { if (all.rate >= 0.6) strengths.zone.push(`Zones hold: ${pct(all.h, all.h + all.f)} paid at least 1R before failing.`); else if (all.f >= 2) rec('zone', `${all.f} of ${all.h + all.f} zones failed outright (price went straight through). Take zones that come from a higher-timeframe point of interest and left an impulsive departure.`, 'minQ', all.f, all.h); }
  if (ho.n >= 2 && hf.n >= 2 && ho.rate != null && hf.rate != null && hf.rate - ho.rate >= 0.25) rec('zone', `Order blocks held ${pct(ho.h, ho.h + ho.f)}, FVGs ${pct(hf.h, hf.h + hf.f)}. Prefer FVGs; take an order block only when the candle itself ran liquidity.`, 'fvgOnly', ho.n, hf.n);
  else if (ho.n >= 2 && ho.rate >= 0.6) strengths.zone.push(`Order blocks are working: ${pct(ho.h, ho.h + ho.f)} held.`);
  if (!OBs.length && n >= 3) strengths.zone.push(`All entries so far were FVGs (no order-block trades yet).`);
  const gq = split('gap', F); if (gq.good.length >= 2 && gq.rest.length >= 2 && avg(gq.good) - avg(gq.rest) >= 0.5) rec('zone', `Healthy gaps averaged ${fmtR(avg(gq.good))}, thin gaps ${fmtR(avg(gq.rest))}. Skip gaps under about 0.3 ATR.`, 'minQ', gq.rest.length, gq.good.length);
  const dq = split('disp', F); if (dq.good.length >= 2 && dq.rest.length >= 2 && avg(dq.good) - avg(dq.rest) >= 0.5) rec('zone', `Gaps from a real displacement candle averaged ${fmtR(avg(dq.good))}, others ${fmtR(avg(dq.rest))}. Only trust a gap with a big-bodied, high-volume candle behind it.`, 'minQ', dq.rest.length, dq.good.length);
  const oq = split('obliq', OBs); if (oq.good.length >= 1 && oq.rest.length >= 2 && avg(oq.good) - avg(oq.rest) >= 0.5) rec('zone', `Order blocks that ran liquidity averaged ${fmtR(avg(oq.good))}, others ${fmtR(avg(oq.rest))}.`, 'fvgOnly', oq.rest.length, oq.good.length);
  const zq = split('depth'); if (zq.good.length >= 2 && zq.rest.length >= 2 && avg(zq.good) - avg(zq.rest) >= 0.5) rec('zone', `Entries deep in the zone averaged ${fmtR(avg(zq.good))}, entries at the edge ${fmtR(avg(zq.rest))}. Wait for the zone's midpoint.`, 'needDepth', zq.rest.length, zq.good.length);
  // ---- liquidity: what was swept, and did price get to the target liquidity
  const fr = T.map(x => O.get(x).frac).filter(v => v != null), avgFr = fr.length ? fr.reduce((a, v) => a + v, 0) / fr.length : null, reached = T.filter(x => O.get(x).reached).length;
  const lq = split('liq'); if (lq.good.length >= 2 && lq.rest.length >= 2 && avg(lq.good) - avg(lq.rest) >= 0.5) rec('liq', `Sweeps of equal highs/lows or the previous day's level averaged ${fmtR(avg(lq.good))}; sweeps of a single swing ${fmtR(avg(lq.rest))}. Wait for real resting liquidity to be taken.`, 'minQ', lq.rest.length, lq.good.length);
  else if (lq.good.length >= 2 && avg(lq.good) > 0.3) strengths.liq.push(`Sweeps of real liquidity pay: ${lq.good.length} trades, ${fmtR(avg(lq.good))} on average.`);
  const pq = split('poi'); if (pq.good.length >= 2 && pq.rest.length >= 2 && avg(pq.good) - avg(pq.rest) >= 0.5) rec('liq', `Sweeps at a higher-timeframe point of interest averaged ${fmtR(avg(pq.good))}, elsewhere ${fmtR(avg(pq.rest))}. Only trade sweeps at a higher-timeframe zone or swing.`, 'needPOI', pq.rest.length, pq.good.length);
  const wq = split('draw'); if (wq.good.length >= 2 && wq.rest.length >= 2 && avg(wq.good) - avg(wq.rest) >= 0.5) rec('liq', `With the higher-timeframe draw: ${fmtR(avg(wq.good))}; against it: ${fmtR(avg(wq.rest))}. Trade toward the draw on liquidity.`, 'needDraw', wq.rest.length, wq.good.length);
  if (fr.length >= 3) {
    if (avgFr < 0.5) rec('liq', `On average price got ${Math.round(avgFr * 100)}% of the way to the target liquidity; ${reached} of ${fr.length} reached it. Targets sit behind too much in the way: prefer targets behind failure swings or the previous day's level, and bank half sooner.`, 'tp1R', fr.length, null);
    else strengths.liq.push(`Targets are realistic: price got ${Math.round(avgFr * 100)}% of the way on average, ${reached} of ${fr.length} reached the target liquidity.`);
  }
  const aft = T.filter(x => O.get(x).after).length; if (aft >= 2) rec('liq', `On ${aft} trades price reached the target liquidity after the exit. The exits came before the draw was delivered: hold for the liquidity unless the zone breaks.`, null, aft, null);
  // ---- execution: stops and management
  const tight = T.filter(x => O.get(x).tight || O.get(x).quick).length, gave = T.filter(x => O.get(x).gave).length;
  if (tight >= 2) rec('exec', `${tight} stops were run within minutes, or run and then the idea worked (+1.5R after the stop). The stop sits inside the wick noise: put it further beyond the sweep.`, 'stopBuf', tight, null);
  if (gave >= 2) rec('exec', `Gave back profit on ${gave} trades (were +1R, closed near zero or worse). Bank half earlier.`, 'tp1R', gave, null);
  if (n >= 3 && !tight && !gave) strengths.exec.push(`Clean management: no stops run inside the noise and no profit given back.`);
  // area scores (0–1)
  const ex = n ? 1 - T.filter(x => O.get(x).tight || O.get(x).quick || O.get(x).gave).length / n : null;
  const sc = {zone: all.h + all.f >= 3 ? all.rate : null, liq: fr.length >= 3 ? Math.min(1, avgFr) : null, exec: n >= 3 ? ex : null};
  const audited = T.filter(x => x.q).length, retro = T.filter(x => x.q && x.q.retro).length;
  return {n, audited, retro, sc, gr: {zone: COACH_GR(sc.zone), liq: COACH_GR(sc.liq), exec: COACH_GR(sc.exec)}, strengths, work, recs,
    stats: {fvg: hf, ob: ho, all, avgFr, reached, aft, tight, gave}};
}
// tell the SMC Trader when the coaching changes; it answers with what it will do
function smCoachTalk(C) {
  RV.smCoach = {t: now(), n: C.n, gr: C.gr, recs: C.recs.map(r => ({area: r.area, txt: r.txt, rule: r.rule, solid: r.solid}))};
  const key = C.n >= 3 ? JSON.stringify([C.gr, C.recs.map(r => r.area + ':' + (r.rule || r.txt.replace(/[\d.,+\-%]+/g, '#').slice(0, 30)) + (r.solid ? '!' : ''))]) : '';
  if (!key || RV.smCoachKey === key) return;
  RV.smCoachKey = key;
  const A = RV.smAdj || {}, AREA = {zone: 'Zones (OB & FVG)', liq: 'Liquidity', exec: 'Execution'};
  const top = C.recs.slice(0, 2);
  rvMemo('rev', 'smc', `Coaching after ${C.n} SMC trades: zones ${C.gr.zone}, liquidity ${C.gr.liq}, execution ${C.gr.exec}.${top.length ? ' Work on: ' + top.map(r => `${AREA[r.area]}: ${r.txt}`).join(' ') : ' Keep doing what you are doing.'}`);
  const RULE = {tp1R: 'I bank half at +1.2R', stopBuf: 'my stop goes further beyond the sweep', minQ: 'I raised my quality bar', fvgOnly: 'FVG entries only', needDepth: 'I wait for the zone\'s midpoint', needPOI: 'only sweeps at a higher-timeframe point of interest', needDraw: 'only trades with the draw on liquidity'};
  const NOTE = {tp1R: 'On targets: I\'ll prefer targets behind failure swings or the previous day\'s level', stopBuf: 'On stops: I\'ll watch for stops sitting inside the sweep\'s wick noise', minQ: 'On zones: I\'ll be pickier about the zones I take', fvgOnly: 'On order blocks: I\'ll only take ones whose candle ran liquidity', needDepth: 'On entries: I\'ll favour deeper entries in the zone', needPOI: 'On sweeps: I\'ll favour sweeps at a higher-timeframe point of interest', needDraw: 'On direction: I\'ll favour trades toward the draw on liquidity'};
  const rep = top.map(r => r.rule && A[r.rule] && SM.cfg.learn ? `Applied: ${RULE[r.rule] || r.rule}.` : r.rule && r.solid && !SM.cfg.learn ? 'Noted; learning is switched off on my desk, so I won\'t change the rule.' : r.rule ? `${NOTE[r.rule] || 'Noted'}; it becomes my rule (${RULE[r.rule] || r.rule}) once enough trades back it.` : 'On exits: I\'ll hold for the liquidity unless the zone breaks.');
  rvMemo('smc', 'rev', top.length ? rep.join(' ') : 'Thanks, carrying on.');
}
function rvItems(p) {
  const b = PT.cfg, I = {}; if (!p) return I;
  if (p.score) I.score = `Minimum reversal signs ${b.minScore} → ${Math.min(8, b.minScore + p.score)}/8`;
  if (p.riskMul !== 1) I.risk = `Risk per trade ${b.riskPct}% → ${(b.riskPct * p.riskMul).toFixed(2)}%`;
  for (const k of ['L', 'S']) { const s = p.side[k]; if (s.score || s.mul !== 1) I['side' + k] = `${k === 'L' ? 'Longs' : 'Shorts'}: ${[s.score ? `need ${s.score} more sign${s.score > 1 ? 's' : ''}` : '', s.mul !== 1 ? `size ×${s.mul}` : ''].filter(Boolean).join(', ')}`; }
  for (const k of p.avoid || []) I['tag:' + k] = `Skip "${k}" setups`;
  for (const k of p.prefer || []) I['pref:' + k] = `Take "${k}" setups first`;
  if (p.needConf) I.conf = 'Enter only at "Reversed", not at "Reversal forming"';
  if (p.tp1R) I.tp1R = `Take half at +${p.tp1R}R (was +${b.tp1R}R)`;
  if (p.tpR) I.tpR = `Full target +${p.tpR}R (was +${b.tpR}R)`;
  if (p.stopBuf) I.stopBuf = `Stop buffer beyond the swing ${p.stopBuf}% (was ${b.stopBuf}%)`;
  if (p.holdH) I.holdH = `Max hold ${p.holdH}h (was ${b.holdH}h)`;
  if (p.volMul !== 1) I.vol = `Min 24h volume ${fmtUsd(b.minVol * p.volMul)} (was ${fmtUsd(b.minVol)})`;
  if (p.fundGuard) I.fund = 'Skip entries where the position would pay ≥0.05%/4h funding';
  if (p.unlDays) I.unl = `No longs within ${p.unlDays} days before a big token unlock (was ${b.unlDays})`;
  if (p.mom && (p.mom.score || p.mom.mul !== 1)) I.mom = `Momentum: need ${Math.min(8, b.momMinScore + p.mom.score)}/8 signs (was ${b.momMinScore}), size ×${p.mom.mul}`;
  return I;
}
/* ---- rules stay until the trades say the opposite ----
   A rule used to disappear as soon as its evidence scrolled out of the window, then come back a few trades later.
   Now a rule that is in force stays until there is opposite evidence from trades closed since it last had support:
     overall edge / one side: 6+ (4+) such trades averaging ≥ 0 · "take first" tags: 3+ of that tag averaging < 0
     "enter only at Reversed": 4+ confirmed entries averaging < 0 · momentum: 8+ momentum trades averaging ≥ 0
     settings (half, target, stop buffer, hold, volume, funding, unlock window): 12 newer trades of that strategy without it triggering again
   Rules that stop their own evidence (skipped tags, "Reversed" only) are re-tested after 5 days. Your own disagreement lifts a rule at once. */
const RV_STICKY_MAX = 5 * 86400e3;
function rvSticky(A, prevP, T) {
  const kept = []; if (!prevP) return kept;
  const p = A.p, oldI = rvItems(prevP), newI = rvItems(p), S = RV.sticky = RV.sticky || {};
  const isM = x => x.strat === 'mom', Tr = T.filter(x => !isM(x)), Tm = T.filter(isM), avg = a => rvMean(a.map(x => x.R));
  for (const k in oldI) {
    if (k in newI) { S[k] = Object.assign(S[k] || {t: now()}, {last: now(), why: A.why[k] || (S[k] || {}).why || ''}); continue; }
    if (RV_HELD.includes(k)) { delete S[k]; continue; }
    const st = S[k] || (S[k] = {t: now(), last: now(), why: ''}), nw = a => a.filter(x => x.t1 > st.last);
    const tag = k.startsWith('tag:') || k.startsWith('pref:') ? k.slice(k.indexOf(':') + 1) : null;
    let rel = now() - st.last > RV_STICKY_MAX, a;
    if (k === 'score' || k === 'risk') { a = nw(Tr); rel = rel || (a.length >= 6 && avg(a) >= 0); }
    else if (k === 'sideL' || k === 'sideS') { a = nw(Tr).filter(x => x.side === k.slice(4)); rel = rel || (a.length >= 4 && avg(a) >= 0); }
    else if (k.startsWith('tag:')) { a = nw(Tr).filter(x => x.tag === tag); rel = rel || (a.length >= 3 && avg(a) >= 0) || (p.prefer || []).includes(tag); }
    else if (k.startsWith('pref:')) { a = nw(Tr).filter(x => x.tag === tag); rel = rel || (a.length >= 3 && avg(a) < 0) || (p.avoid || []).includes(tag); }
    else if (k === 'conf') { a = nw(Tr).filter(x => rvStage(x) === 'done'); rel = rel || (a.length >= 4 && avg(a) < 0); }
    else if (k === 'mom') { a = nw(Tm); rel = rel || (a.length >= 8 && avg(a) >= 0); }
    else rel = rel || nw(Tr).length >= 12;
    if (rel) { delete S[k]; continue; }
    // carry the rule over from the previous review
    if (k === 'score') p.score = prevP.score; else if (k === 'risk') p.riskMul = prevP.riskMul;
    else if (k === 'sideL' || k === 'sideS') p.side[k.slice(4)] = JSON.parse(JSON.stringify(prevP.side[k.slice(4)]));
    else if (k.startsWith('tag:')) p.avoid.push(tag); else if (k.startsWith('pref:')) p.prefer.push(tag);
    else if (k === 'conf') p.needConf = true; else if (k === 'vol') p.volMul = prevP.volMul; else if (k === 'fund') p.fundGuard = true;
    else if (k === 'unl') p.unlDays = prevP.unlDays; else if (k === 'mom') p.mom = JSON.parse(JSON.stringify(prevP.mom));
    else if (k in prevP) p[k] = prevP[k];             // tp1R, tpR, stopBuf, holdH
    A.why[k] = st.why || A.why[k] || ''; kept.push(oldI[k]);
  }
  for (const k in rvItems(p)) if (!S[k]) S[k] = {t: now(), last: now(), why: A.why[k] || ''};
  for (const k in S) if (!(k in rvItems(p))) delete S[k];
  if (kept.length) A.F.push({t: 'info', d: `Kept in force (no opposite evidence yet): ${kept.join(' · ')}.`});
  return kept;
}
function rvRun(manual) {
  // the last 40 trades of EACH strategy (a mixed window was barely a day of trades, so rules kept flipping)
  const all = PT.log.filter(x => !rvManual(x));
  const T = [...all.filter(x => x.strat !== 'mom').slice(0, RV_WIN), ...all.filter(x => x.strat === 'mom').slice(0, RV_WIN)].sort((a, b) => b.t1 - a.t1);
  if (T.length < 3) return `Need at least 3 closed trades to review. There ${T.length === 1 ? 'is' : 'are'} ${T.length} so far.`;
  T.forEach(rvPostCheck);
  const A = rvAnalyze(T), prevP = RV.active ? ((RV.reviews.find(r => r.id === RV.active.id) || {}).prop || RV.active) : null;
  rvSticky(A, prevP, T);
  const oldI = rvItems(prevP), newI = rvItems(A.p), changes = [];
  for (const k in newI) if (oldI[k] !== newI[k]) changes.push({k, kind: k in oldI ? 'changed' : 'new', txt: newI[k], why: A.why[k] || ''});
  for (const k in oldI) if (!(k in newI)) changes.push({k, kind: 'lifted', txt: 'Lifted: ' + oldI[k], why: RV_HELD.includes(k) ? 'You disagreed with the point it rests on.' : 'Trades closed since it was set say the opposite, or it was due a re-test.'});
  const rv = {id: ++RV.seq, t: now(), manual: !!manual, n: T.length, span: [T[T.length - 1].t0, T[0].t1], O: A.O, pf: A.pf, fees: A.fees, fund: A.fund, G: A.G, F: A.F,
    grades: T.reduce((m, x) => { const g = (x.g || rvGrade(x)).g; m[g] = (m[g] || 0) + 1; return m; }, {}), changes, prop: A.p, status: 'pending', trader: null};
  RV.reviews.unshift(rv); if (RV.reviews.length > 30) RV.reviews.pop();
  RV.pending = rv.id; RV.lastT = now(); rvSave();
  raise('rev', 'ACCOUNT', 'rv' + rv.id, `Review #${rv.id} (${T.length} trades): ${A.O.win.toFixed(0)}% win, avg ${fmtR(A.O.avgR)}. ${changes.length ? changes.length + ' rule change' + (changes.length > 1 ? 's' : '') + ' sent to the Trader' : 'No rule changes. Keep executing.'}`, A.O.avgR >= 0 ? 1 : -1, 0, true);
  return null;
}

/* ---- the Trader reads the review before trading again ---- */
function trSimulate(H, A) {
  return H.filter(c => c.strat === 'mom'
    ? c.score >= ptRules(c.side === 'G' ? 'L' : 'S', c.tag, A, 'mom').minScore && !(c.rev >= 2) && !(fin(c.ext) && Math.abs(c.ext) * 100 > PT.cfg.momMaxExt)
    : !ptGate(c.side, c.key, c.score, c.tag, null, A));
}
function trPlan(A) {
  const out = [];
  if (PT.cfg.stratRev) for (const k of PT.cfg.revLong ? ['S', 'L'] : ['S']) { const R = ptRules(k, '', A); out.push(`Reversal ${k === 'L' ? 'longs (buy losers)' : 'shorts (fade gainers)'}: need ${R.minScore}/8 signs, risk ${R.riskPct.toFixed(2)}% of equity per trade.`); }
  else out.push('Reversal trades: off.');
  if (PT.cfg.stratMom) { const M = ptRules('L', '', A, 'mom'); out.push(`Momentum (trade with strong moves): need ${M.minScore}/8 momentum signs, risk ${M.riskPct.toFixed(2)}%, at most ${PT.cfg.momMaxPos} at once, nothing stretched over ${PT.cfg.momMaxExt}% from the EMA. Out when momentum fades, reversal signs form, or after ${M.holdH}h.`); }
  else out.push('Momentum trades: off.');
  const R = ptRules('L', '', A), b = PT.cfg;
  if (R.needConf) out.push('Wait for "Reversed". No entries while the reversal is only forming.');
  if (A && A.avoid && A.avoid.length) out.push(`Skip setups tagged ${A.avoid.map(x => '"' + x + '"').join(', ')}.`);
  if (A && A.prefer && A.prefer.length) out.push(`When several coins qualify, take ${A.prefer.map(x => '"' + x + '"').join(', ')} first.`);
  out.push(`Stop ${R.stopBuf}% beyond the swing. Half off at +${R.tp1R}R, then breakeven and trail. Full exit at +${R.tpR}R or after ${R.holdH}h.`);
  if (R.minVol !== b.minVol) out.push(`Only coins with ${fmtUsd(R.minVol)}+ daily volume.`);
  if (R.fundGuard) out.push("Don't open a side that pays ≥0.05%/4h in funding.");
  if (PT.cfg.unlGuard) out.push(`No longs within ${R.unlDays} days before a big token unlock (≥${PT.cfg.unlMinPct}% of circulating); longs closed 12 h before one. Shorts into an upcoming unlock get priority.`);
  return out;
}
function trReview(rv) {
  const p = JSON.parse(JSON.stringify(rv.prop)), notes = {}, b = PT.cfg, prev = RV.active;
  // a) never require more than 7/8 signs: 8/8 almost never prints, so that would quietly stop all trading
  for (const k of ['L', 'S']) {
    const tot = b.minScore + p.score + p.side[k].score;
    if (tot > 7) {
      let cut = tot - 7; const fromSide = Math.min(cut, p.side[k].score); p.side[k].score -= fromSide; cut -= fromSide; p.score = Math.max(0, p.score - cut);
      notes.score = notes['side' + k] = {a: 'adjusted', note: 'Capped at 7/8 signs. 8/8 almost never happens, so that would stop all trading instead of filtering it.'};
    }
  }
  // a2) same cap for momentum
  if (p.mom && b.momMinScore + p.mom.score > 7) { p.mom.score = Math.max(0, 7 - b.momMinScore); notes.mom = {a: 'adjusted', note: 'Capped momentum at 7/8 signs so it can still trade.'}; }
  // b) only size back up once recent trades are positive
  const prevMul = prev ? prev.riskMul : 1, last3 = PT.log.filter(x => !rvManual(x)).slice(0, 3), s3 = last3.reduce((a, x) => a + x.R, 0);
  if (p.riskMul > prevMul && s3 < 0) { p.riskMul = prevMul; notes.risk = {a: 'held', note: `Keeping the smaller size for now. My last 3 trades are net ${fmtR(s3)}, so I'll size back up after they turn positive.`}; }
  // c) what-if on the last 24h of candidates
  const H = (PT.cands || []).filter(c => now() - c.t < 24 * 3600e3), before = trSimulate(H, prev), after = trSimulate(H, p);
  const lost = before.filter(c => !after.includes(c)), gained = after.filter(c => !before.includes(c));
  const changes = rv.changes.map(c => Object.assign({}, c, notes[c.k] || {a: 'ok', note: c.kind === 'lifted' ? 'Agreed, back to normal.' : 'Accepted.'}));
  p.id = rv.id;
  const resp = {t: now(), changes, sim: {n: H.length, before: before.length, after: after.length, lost: [...new Set(lost.map(c => c.b))], gained: [...new Set(gained.map(c => c.b))]}, plan: trPlan(p)};
  rv.trader = resp; rv.status = changes.some(c => c.a !== 'ok') ? 'adjusted' : 'accepted'; rv.final = p;
  RV.active = p; RV.pending = null; rvSave();
  const nA = changes.filter(c => c.a === 'ok').length, nX = changes.length - nA;
  raise('trader', 'ACCOUNT', 'ack' + rv.id, changes.length
    ? `Read review #${rv.id}: accepted ${nA}${nX ? `, adjusted ${nX}` : ''} of ${changes.length} changes. ${H.length ? `${after.length} of the last ${H.length} candidates would still qualify.` : ''}`
    : `Read review #${rv.id}: no changes. Same rules, carrying on.`, 0, 0, true);
}
// called by the Trader each scan: returns a skip reason while it is still reading a review
function trReadPending() {
  if (!RV.pending) return null;
  const rv = RV.reviews.find(r => r.id === RV.pending);
  if (!rv) { RV.pending = null; return null; }
  if (now() - rv.t < 20e3) return `reading the Reviewer's review #${rv.id}`;
  trReview(rv); return null;
}
// called after every Trader tick: grade new trades, check stop-outs afterwards, decide when to review
function rvTick() {
  if (now() - (RVF.prof || 0) > 60e3) { RVF.prof = now(); try { profTick(); } catch (e) { console.warn('profile', e.message); } }
  if (now() - RVF.last > 120e3 && (typeof syTrading !== 'function' || syTrading())) rvFollowTick(2);
  if (!RV.on) return;
  let changed = false;
  for (const x of PT.log) {
    if (!x.g) {
      x.g = rvGrade(x); changed = true;
      if (now() - x.t1 < 10 * 60e3 && x.g.g !== '—') raise('rev', x.s, 'g' + x.t1, `${x.b} ${x.side === 'L' ? 'long' : 'short'} graded ${x.g.g} (${fmtR(x.R)}): ${x.g.note}`, x.R >= 0 ? 1 : -1, 0);
    }
    if (!x.post && /stop loss/.test(x.exitWhy || '')) { rvPostCheck(x); if (x.post) changed = true; }
  }
  if (changed) ptSave();
  if (!RV.auto || RV.pending) return;
  const fresh = PT.log.filter(x => x.t1 > RV.lastT && !rvManual(x)).length, total = PT.log.filter(x => !rvManual(x)).length;
  // you reviewed 2+ Trader trades since the last review: run one now so your opinion is weighed in
  const yours = PT.log.filter(x => { const m = mineOf(x); return m && m.t > RV.lastT; }).length;
  if (yours >= 2 && total >= 3) { const msg = rvRun(false); if (!msg) raise('rev', 'ACCOUNT', 'yourrv' + now(), `Weighed in your ${yours} new trade reviews.`, 1, 0); return; }
  if (total >= 3 && (fresh >= RV.every || (fresh >= 1 && now() - RV.lastT > 12 * 3600e3))) rvRun(false);
}

/* ---- 24h follow-up: what each trade did after it closed, and how other chart timeframes would have managed it ---- */
// 24 h after a trade closes, the Reviewer pulls its candles and replays the same entry three ways:
//   15m · same stop, no early exits (no "signals faded" or time stop): half at the first target, 15m EMA20 trail, full target
//   1h  · stop beyond the 12h swing read on 1h candles (never tighter than the real stop), 1h EMA20 trail
//   4h  · stop beyond the 24h swing read on 4h candles, 4h EMA20 trail
// Price is walked on 15m candles in every case (worst case first inside each candle), until 24 h after the real exit.
// R is net of fees and slippage, and each version risks the same 1%, so a wider stop means a smaller position.
const RV_TF = {'15m': {ms: 15 * 60e3, sw: 24, lab: '15m chart, no early exits'}, '1h': {ms: 3600e3, sw: 12, lab: '1h chart'}, '4h': {ms: 4 * 3600e3, sw: 6, lab: '4h chart'}};
const RV_FU_H = 24, RVF = {busy: false, last: 0};
function rvSimTf(x, B15, Btf, tf, acct) {
  const L = x.side === 'L', sg = L ? 1 : -1, E = x.entry, d0 = Math.abs(E - x.stop0), T = RV_TF[tf], end = x.t1 + RV_FU_H * 3600e3;
  let d = d0;
  if (tf !== '15m') {
    const pre = Btf.filter(b => b[0] + T.ms <= x.t0).slice(-T.sw); if (pre.length < Math.min(3, T.sw)) return {na: 'not enough candles'};
    const buf = (acct === 'sm' ? SM.cfg.stopBuf : PT.cfg.stopBuf) / 100;
    const sw = L ? Math.min(...pre.map(b => b[3])) * (1 - buf) : Math.max(...pre.map(b => b[2])) * (1 + buf);
    d = Math.max(d0, sg * (E - sw));
  }
  if (d / E > 0.3) return {na: `stop would be ${(d / E * 100).toFixed(0)}% away`};
  const cost = 2 * (PT.cfg.feePct + PT.cfg.slipPct) / 100 * E / d;
  const t1R = (acct === 'sm' ? SM.cfg.tp1R : x.tp1R || PT.cfg.tp1R), tpPx = acct === 'sm' && fin(x.target) ? x.target : E + sg * (x.tpR || PT.cfg.tpR) * d;
  const half = E + sg * t1R * d;
  // EMA20 of the timeframe's closes, known at each candle's close
  const cl = Btf.map(b => b[4]), em = emaArr(cl, 20), emaAt = t => { let v = null; for (let i = 0; i < Btf.length && Btf[i][0] + T.ms <= t; i++) if (i >= 19) v = em[i]; return v; };
  let stop = E - sg * d, real = 0, rest = 1, h = false, why = 'still open 24h after the exit';
  const path = B15.filter(b => b[0] >= x.t0 && b[0] < end);
  for (const b of path) {
    const adv = L ? b[3] : b[2], fav = L ? b[2] : b[3];
    if (sg * (adv - stop) <= 0) { real += rest * sg * (stop - E) / d; rest = 0; why = !h ? 'stop' : sg * (stop - E) > 1e-12 ? 'trailing stop' : 'breakeven'; break; }
    if (!h && sg * (fav - half) >= 0) { h = true; real += 0.5 * t1R; rest = 0.5; stop = L ? Math.max(stop, E) : Math.min(stop, E); }
    if (sg * (fav - tpPx) >= 0) { real += rest * sg * (tpPx - E) / d; rest = 0; why = 'target'; break; }
    if (h) { const e = emaAt(b[0] + 15 * 60e3); if (fin(e)) { const ts = L ? e * 0.995 : e * 1.005; if (L ? ts > stop : ts < stop) stop = ts; } }
  }
  if (rest > 0 && path.length) real += rest * sg * (path[path.length - 1][4] - E) / d;
  return {R: real - cost, why, stopPct: d / E * 100};
}
// after the exit: did price go on to the first target before touching the original stop?
function rvAfterExit(x, B15) {
  const L = x.side === 'L', sg = L ? 1 : -1, E = x.entry, d = Math.abs(E - x.stop0), end = x.t1 + RV_FU_H * 3600e3;
  let mx = -Infinity, tMax = x.t1, pMax = x.exit, hitStop = false, tStop = null, reach = false, end24 = null;
  for (const b of B15.filter(b => b[0] + 15 * 60e3 > x.t1 && b[0] < end)) {
    const adv = L ? b[3] : b[2], fav = L ? b[2] : b[3], r = sg * (fav - E) / d;
    if (!hitStop && r > mx) { mx = r; tMax = b[0] + 7.5 * 60e3; pMax = fav; if (r >= 1.5) reach = true; }
    if (!hitStop && sg * (adv - x.stop0) <= 0) { hitStop = true; tStop = b[0]; }
    end24 = sg * (b[4] - E) / d;
  }
  const lost = x.R <= 0, early = !/stop loss/.test(x.exitWhy || '');
  let v, txt;
  if (lost) {
    if (reach) { v = early ? 'early' : 'tight'; txt = early ? `Closed too early: after the exit, price reached +${mx.toFixed(1)}R before touching the stop` : `Stop too tight: after the stop-out, price went on to +${mx.toFixed(1)}R`; }
    else if (hitStop && early) { v = 'saved'; txt = `Early exit was right: price later hit the stop (saved ${fmtR(x.R + 1)})`; }
    else { v = 'right'; txt = `Exit was right: price never got back to +1.5R in the next ${RV_FU_H}h (best +${Math.max(0, mx).toFixed(1)}R)`; }
  } else if (mx > Math.max(x.maxR || 0, x.R) + 1) { v = 'left'; txt = `Left money: after the exit, price ran to +${mx.toFixed(1)}R`; }
  else { v = 'fine'; txt = `Good exit: price did not go much further (best +${Math.max(0, mx).toFixed(1)}R after)`; }
  return {v, txt, mx: fin(mx) ? mx : 0, tMax, pMax, hitStop, tStop, end: end24};
}
async function rvFollowOne(x, acct) {
  const end = x.t1 + RV_FU_H * 3600e3;
  const kl = async (iv, ms) => (await api(`/fapi/v1/klines?symbol=${x.s}&interval=${iv}&startTime=${x.t0 - 30 * ms}&endTime=${end}&limit=1500`)).map(b => [+b[0], +b[1], +b[2], +b[3], +b[4]]);
  const B15 = await kl('15m', 15 * 60e3), B1 = await kl('1h', 3600e3), B4 = await kl('4h', 4 * 3600e3);
  if (B15.length < 10) throw new Error('no candles');
  const sim = {'15m': rvSimTf(x, B15, B15, '15m', acct), '1h': rvSimTf(x, B15, B1, '1h', acct), '4h': rvSimTf(x, B15, B4, '4h', acct)};
  const af = rvAfterExit(x, B15);
  const ok = Object.entries(sim).filter(([, v]) => fin(v.R)).sort((a, b) => b[1].R - a[1].R)[0];
  x.fu = {t: now(), af, sim, best: ok ? ok[0] : null};
  if (x.R <= 0) raise('rev', x.s, 'fu' + x.t1, `${x.b} ${x.side === 'L' ? 'long' : 'short'}${acct === 'sm' ? ' (SMC)' : ''}, 24h after its ${fmtR(x.R)} exit: ${af.txt}. Replayed: 15m ${fmtR(sim['15m'].R)} · 1h ${fmtR(sim['1h'].R)} · 4h ${fmtR(sim['4h'].R)}`, af.v === 'early' || af.v === 'tight' ? -1 : 1, 0);
}
/* ---- after-the-fact SMC audit: trades opened before the quality read existed are re-read with the candles that existed
   at entry (15m/1h up to the entry time, price = the entry), so the Reviewer can judge their FVG / OB / liquidity too. */
async function smAudit(x) {
  const t0 = x.t0, {B15, H1} = await smEntryBars(x);
  const zoneOf = x.zone || null, near = r => r && r.dir === x.side && r.q && r.zone && (zoneOf ? r.zone.lo <= zoneOf.hi && r.zone.hi >= zoneOf.lo : x.entry >= r.zone.lo - (r.zone.hi - r.zone.lo) && x.entry <= r.zone.hi + (r.zone.hi - r.zone.lo));
  let hit = null;
  try {
    SM_OVR = {s: x.s, '15m': B15, '1h': H1, tk: {last: x.entry}, t: t0, dir: x.side};
    for (const tf of [x.tf || '15m', (x.tf || '15m') === '15m' ? '1h' : '15m']) { const r = smcReadTf(x.s, tf); if (near(r)) { hit = r; break; } }
  } finally { SM_OVR = null; }
  if (!hit) { x.qa = {t: now(), miss: 1}; return false; }
  x.q = {score: hit.q.score, grade: hit.q.grade, items: hit.q.items, zs: hit.q.zs, dz: hit.q.dz, retro: 1};
  if (!x.htfBias && hit.bias) x.htfBias = hit.bias; if (!x.tf) x.tf = hit.tf; x.qa = {t: now(), ok: 1};
  return true;
}
/* ---- zone backfill (Nov 13): label every candidate FVG / OB of past SMC trades from the 15m candles in the 48 h after entry,
   so smZoneTune can learn which zones were right. Rows from before zc existed are re-read at entry, as smAudit does.
   At most `max` trades per call (API load); a failed fetch leaves the row for the next cycle. */
const SMZ_LAB_H = 48;
async function smZoneBackfill(max = 5) {
  let n = 0;
  for (const x of SM.log.filter(x => !(x.zc && x.zc.done) && !x.zcSkip && !rvManual(x) && now() - x.t0 >= SMZ_LAB_H * 3600e3 && !(x.zcErr && now() - x.zcErr < 30 * 60e3)).slice(0, max)) {
    try {
      if (!x.zone || !fin(x.zone.lo) || !fin(x.sweep)) { x.zcSkip = 'no zone or sweep recorded'; continue; }
      if (!x.zc) {
        const {B15, H1} = await smEntryBars(x); let r = null;
        try { SM_OVR = {s: x.s, '15m': B15, '1h': H1, tk: {last: x.entry}, t: x.t0, dir: x.side}; r = smcReadTf(x.s, x.tf || '15m'); } finally { SM_OVR = null; }
        const Z = r && r.dir === x.side && r.setup && r.setup.zc ? r.setup.zc.c : null;
        if (!Z) { x.zcSkip = 'setup not found at entry'; continue; }
        // the zone actually traded: the overlapping candidate of the same kind nearest to it (-1: the trade's zone isn't among them)
        const d = z => z.kind === x.zone.kind && z.lo <= x.zone.hi && z.hi >= x.zone.lo ? Math.abs(z.lo - x.zone.lo) + Math.abs(z.hi - x.zone.hi) : Infinity;
        const k = Z.reduce((b, z, i) => d(z) < (b < 0 ? Infinity : d(Z[b])) ? i : b, -1);
        x.zc = {c: Z, k};
      }
      const B = (await api(`/fapi/v1/klines?symbol=${x.s}&interval=15m&startTime=${x.t0}&limit=${SMZ_LAB_H * 4}`)).map(b => [+b[0], +b[1], +b[2], +b[3], +b[4], +b[7]]);
      if (B.length < 8) throw new Error('no candles');
      for (const z of x.zc.c) Object.assign(z, smZoneLabel(B, z, x.side, smZoneStop(z, x.side, x.sweep)));
      x.zc.done = 1; n++;
    } catch (e) { x.zcErr = now(); }
  }
  return n;
}
// the 15m and 1h candles the desk saw at a trade's entry (closed bars, plus the forming 15m rebuilt from 1m up to the entry)
async function smEntryBars(x) {
  const t0 = x.t0, kl = async (iv, ms, n) => (await api(`/fapi/v1/klines?symbol=${x.s}&interval=${iv}&startTime=${t0 - (n + 1) * ms}&endTime=${t0}&limit=${n + 3}`)).map(b => [+b[0], +b[1], +b[2], +b[3], +b[4], +b[7], +b[10]]);
  const B15 = (await kl('15m', 15 * 60e3, 96)).filter(b => b[0] + 15 * 60e3 <= t0), H1 = (await kl('1h', 3600e3, 96)).filter(b => b[0] + 3600e3 <= t0);
  // the candle that was still forming at entry, rebuilt from 1-minute candles up to the entry (the desk saw it live)
  const fb = Math.floor(t0 / (15 * 60e3)) * 15 * 60e3;
  if (t0 > fb) { const M = (await api(`/fapi/v1/klines?symbol=${x.s}&interval=1m&startTime=${fb}&endTime=${t0 - 1}&limit=20`)).map(b => [+b[0], +b[1], +b[2], +b[3], +b[4], +b[7], +b[10]]).filter(b => b[0] < t0);
    if (M.length) B15.push([fb, M[0][1], Math.max(...M.map(b => b[2]), x.entry), Math.min(...M.map(b => b[3]), x.entry), x.entry, M.reduce((a, b) => a + b[5], 0), M.reduce((a, b) => a + b[6], 0)]); }
  if (B15.length < 40 || H1.length < 30) throw new Error('no candles');
  return {B15, H1};
}
// runs in the browser that trades (every 2 min) and in the cloud (each cycle): picks up trades whose 24h has passed
async function rvFollowTick(max = 2) {
  if (RVF.busy) return 0; RVF.busy = true; RVF.last = now(); let n = 0;
  try {
    const due = [];
    for (const [a, L] of [['pt', PT.log], ['sm', typeof SM !== 'undefined' ? SM.log : []]])
      for (const x of L) if (!x.fu && !rvManual(x) && now() >= x.t1 + RV_FU_H * 3600e3 + 5 * 60e3 && now() - x.t1 < 30 * 864e5 && !(x.fuErr && now() - x.fuErr < 30 * 60e3)) due.push([a, x]);
    due.sort((p, q) => p[1].t1 - q[1].t1);
    for (const [a, x] of due.slice(0, max)) { try { await rvFollowOne(x, a); n++; } catch (e) { x.fuErr = now(); } }
    // older SMC trades without a quality read: audit them from the candles at entry
    if (typeof SM !== 'undefined') for (const x of SM.log.filter(x => !x.q && !x.qa && !rvManual(x) && !(x.qaErr && now() - x.qaErr < 30 * 60e3)).slice(0, Math.max(1, max - n))) {
      try { await smAudit(x); n++; } catch (e) { x.qaErr = now(); }
    }
    // label the candidate zones of past SMC trades for the zone tuner (smZoneTune, in smLearn)
    if (typeof SM !== 'undefined') n += await smZoneBackfill(5);
    if (n) { ptSave(); if (typeof smSave === 'function') smSave(); }
  } finally { RVF.busy = false; }
  return n;
}
// which timeframe would have managed the trades best (all followed trades, so wider stops are also judged on the winners they'd give back)
const RV_TF_MIN = 8;
function rvTfStudy(L) {
  const T = L.filter(x => x.fu && x.fu.sim), cols = ['act', '15m', '1h', '4h'];
  const agg = A => Object.fromEntries(cols.map(k => { const R = A.map(x => k === 'act' ? x.R : (x.fu.sim[k] || {}).R).filter(fin); return [k, {n: R.length, avg: rvMean(R), win: R.length ? R.filter(v => v > 0).length / R.length * 100 : null, sum: R.reduce((a, b) => a + b, 0)}]; }));
  const all = agg(T), lost = agg(T.filter(x => x.R <= 0)), vd = {};
  for (const x of T.filter(x => x.R <= 0)) vd[x.fu.af.v] = (vd[x.fu.af.v] || 0) + 1;
  const pending = L.filter(x => !x.fu && !rvManual(x) && now() - x.t1 < RV_FU_H * 3600e3).length;
  let rec;
  if (T.length < RV_TF_MIN) rec = {k: 'wait', txt: `Not enough evidence yet: ${T.length} trade${T.length === 1 ? '' : 's'} followed, needs ${RV_TF_MIN}. Keep trading as is.`};
  else {
    const best = ['15m', '1h', '4h'].filter(k => all[k].n >= RV_TF_MIN).sort((a, b) => all[b].avg - all[a].avg)[0], A = all.act.avg;
    if (best && all[best].avg - A >= 0.3 && all[best].avg > 0) rec = {k: best, txt: best === '15m'
      ? `Keep the 15m chart, but stop exiting early: holding to the stop, trail or target would have averaged ${fmtR(all['15m'].avg)} per trade vs ${fmtR(A)} with the early exits.`
      : `Manage trades on the ${best} chart: a stop beyond the ${best} swing and a ${best} EMA20 trail would have averaged ${fmtR(all[best].avg)} per trade vs ${fmtR(A)} with the current 15m exits.`};
    else rec = {k: 'stay', txt: `Stay on the current exits: no timeframe beat them by 0.3R or more per trade${best ? ` (best: ${best === '15m' ? '15m without early exits' : best}, ${fmtR(all[best].avg)} vs ${fmtR(A)})` : ''}.`};
  }
  return {n: T.length, all, lost, vd, pending, rec};
}

/* ---- screening criteria: which level of each coin reading led to better trades ---- */
// When a trade opens, the coin's readings are saved with it (entryCtx), turned to the direction of the coin's move
// (+ for a gainer, − for a loser) so gainers and losers can be judged together: "flow" = net taker flow WITH the move.
// The Reviewer then looks, per strategy, for the level of each reading that split good trades from bad ones,
// and publishes the clear ones as a screening profile that GainerLoser, OpenInterest and Flow use to rate coins.
function entryCtx(s, checks) {
  const m = mget(s), tk = S.tk.get(s) || {}, h = h1Stats(s), side = sideOf(s), dir = side === 'G' ? 1 : -1, fr = f4(s), e = S.trk[s];
  const rk = (side === 'G' ? S.gainers : S.losers).indexOf(s), rsi = h && h.rsi.length ? h.rsi[h.rsi.length - 1] : null;
  const r = v => fin(v) ? +(+v).toFixed(4) : null;
  return {mv: r(Math.abs(tk.pct)), qv: r(tk.qv), rank: rk >= 0 ? rk + 1 : null, trkH: e ? r((now() - e.t0) / 3600e3) : null, volX: h ? r(h.volX) : null,
    ext: h ? r(Math.abs(dir > 0 ? h.fromHi : h.fromLo) * 100) : null, mv1h: fin(m.pct1h) ? r(dir * m.pct1h) : null, rsi: fin(rsi) ? r(dir > 0 ? rsi : 100 - rsi) : null,
    oi1h: r(fin(m.oi60) ? m.oi60 : m.oi15), flow: fin(m.net1h) && m.vol1h ? r(dir * m.net1h / m.vol1h * 100) : null,
    bs: fin(m.ratio1h) && m.ratio1h > 0 ? r(dir > 0 ? m.ratio1h : 1 / m.ratio1h) : null, fund: fin(fr) ? r(dir * fr * 100) : null,
    sg: (checks || []).map(c => c.ok === true ? 1 : c.ok === false ? 0 : null), side};
}
// ag = the agent that screens on it; lv = levels tested as cut-offs; u = unit
const CRIT = [
  {k: 'mv', ag: 'scout', lab: 'Size of the 24h move', u: '%', lv: [15, 25, 40, 60, 100]},
  {k: 'qv', ag: 'scout', lab: '24h volume', u: '$', lv: [3e5, 5e5, 1e6, 2e6, 5e6]},
  {k: 'rank', ag: 'scout', lab: 'Rank in the top 5 (1 = biggest mover)', u: '#', lv: [2, 3, 4, 5]},
  {k: 'trkH', ag: 'scout', lab: 'Hours since it entered the top 5', u: 'h', lv: [1, 3, 6, 12]},
  {k: 'volX', ag: 'scout', lab: 'Volume vs the previous day', u: '×', lv: [1, 1.5, 2.5, 4]},
  {k: 'ext', ag: 'scout', lab: 'Distance from the 24h high (gainers) / low (losers)', u: '%', lv: [3, 8, 15, 25]},
  {k: 'mv1h', ag: 'scout', lab: 'Last-hour move, in the trend\'s direction', u: '%', lv: [-5, -2, 0, 2, 5]},
  {k: 'rsi', ag: 'scout', lab: '1h RSI, in the trend\'s direction', u: '', lv: [50, 60, 70, 80]},
  {k: 'oi1h', ag: 'ivy', lab: 'Open interest change, last hour', u: '%', lv: [-5, -2, 0, 2, 5]},
  {k: 'flow', ag: 'flo', lab: 'Net taker flow 1h with the trend (% of volume)', u: '%', lv: [-20, -10, 0, 10, 20]},
  {k: 'bs', ag: 'flo', lab: 'Taker buy/sell 1h with the trend', u: '×', lv: [0.8, 0.9, 1, 1.1, 1.25]},
  {k: 'fund', ag: 'flo', lab: 'Funding crowded with the trend (%/4h)', u: '%', lv: [-0.03, 0, 0.02, 0.05, 0.08]}];
const CRIT_SIGNS = {
  rev: ['Lower high / higher low on 15m', 'Crossed the 15m EMA20', 'Net flow turned (1h)', 'Taker pressure turned', 'Rejection wick ≥ 5%', 'Crowd paying funding', 'OI not backing the move', '1h RSI turning from an extreme'],
  mom: ['Fresh 15m high / low', 'Sloping 15m EMA20', 'Net flow with the move', 'Taker pressure with the move', 'Volume expanding', 'Funding not crowded', 'OI building with the move', '1h RSI strong, not exhausted'],
  smc: ['Liquidity swept', 'Structure shift', 'Fair value gap (not OB)', 'Discount / premium entry', '1h bias aligned', 'Displacement on volume']};
const CRIT_STRAT = {rev: 'Reversal (Trader)', mom: 'Momentum (Trader)', smc: 'SMC Trader'};
const STRAT_NOUN = {rev: 'reversal trades', mom: 'momentum trades', smc: 'SMC trades'};
// many readings × several levels are tested, so a gap can appear by luck: a level is published only with enough trades
// on both sides, a gap of 0.4R+, a Welch t-statistic of 3.2+, and the same gap (≥0.25R, same direction, 4+ trades a side) in both the older and the newer half of the trades.
// Simulated on random data: about one chance pattern per 10–30 checks; a real 0.8R gap is caught ~60% of the time by 80 trades
const CRIT_MIN = 20, CRIT_SIDE = 8, CRIT_EDGE = 0.4, CRIT_T = 3.2, CRIT_HALF = 4;
function critT(A, B) {
  const m = a => a.reduce((x, y) => x + y, 0) / a.length, v = (a, mu) => a.reduce((x, y) => x + (y - mu) ** 2, 0) / Math.max(1, a.length - 1);
  const ra = A.map(x => x.R), rb = B.map(x => x.R), ma = m(ra), mb = m(rb), se = Math.sqrt(v(ra, ma) / ra.length + v(rb, mb) / rb.length);
  return se > 1e-9 ? (ma - mb) / se : (ma === mb ? 0 : Math.sign(ma - mb) * 99);
}
const critFmt = (c, v) => c.u === '$' ? fmtUsd(v) : c.u === '#' ? '#' + v : c.u === '×' ? v + '×' : c.u === 'h' ? v + 'h' : v + (c.u || '');
const critTrades = st => (st === 'smc' ? (typeof SM !== 'undefined' ? SM.log : []) : PT.log.filter(x => (x.strat || 'rev') === st)).filter(x => x.cx && !rvManual(x));
function critSplit(T, c) {
  const V = T.filter(x => fin(x.cx[c.k])); let best = null;
  for (const t of c.lv) {
    const A = V.filter(x => x.cx[c.k] >= t), B = V.filter(x => x.cx[c.k] < t);
    if (A.length < CRIT_SIDE || B.length < CRIT_SIDE) continue;
    const a = rvAgg(A), b = rvAgg(B), d = a.avgR - b.avgR, ts = critT(A, B);
    if (!best || Math.abs(ts) > Math.abs(best.ts)) best = {t, a, b, d, ts};
  }
  const ed = [-Infinity, ...c.lv, Infinity], bk = [];
  for (let i = 0; i < ed.length - 1; i++) { const A = V.filter(x => x.cx[c.k] >= ed[i] && x.cx[c.k] < ed[i + 1]); if (A.length) bk.push(Object.assign({lo: ed[i], hi: ed[i + 1]}, rvAgg(A))); }
  return {n: V.length, best, bk};
}
// the pattern must repeat in the older and the newer half of the trades (a chance pattern rarely does)
function critHoldsDir(T, inA, up) {
  const S2 = [...T].sort((a, b) => a.t1 - b.t1), h = Math.floor(S2.length / 2);
  return [S2.slice(0, h), S2.slice(h)].every(H => { const A = H.filter(inA), B = H.filter(x => !inA(x)); if (A.length < CRIT_HALF || B.length < CRIT_HALF) return false; const d = rvAgg(A).avgR - rvAgg(B).avgR; return up ? d >= 0.25 : d <= -0.25; });
}
function critSign(T, i) {
  const A = T.filter(x => x.cx.sg && x.cx.sg[i] === 1), B = T.filter(x => x.cx.sg && x.cx.sg[i] === 0);
  return {a: rvAgg(A), b: rvAgg(B), d: A.length && B.length ? rvAgg(A).avgR - rvAgg(B).avgR : null, ts: A.length > 1 && B.length > 1 ? critT(A, B) : 0};
}
// the published profile: only splits with enough trades on both sides and a clear gap
function rvProfile() {
  const F = [], n = {};
  for (const st of ['rev', 'mom', 'smc']) {
    const T = critTrades(st); n[st] = T.length; if (T.length < CRIT_MIN) continue;
    for (const c of CRIT) {
      const sp = critSplit(T, c), b = sp.best; if (!b || Math.abs(b.d) < CRIT_EDGE || Math.abs(b.ts) < CRIT_T) continue;
      if (!critHoldsDir(T.filter(x => fin(x.cx[c.k])), x => x.cx[c.k] >= b.t, b.d > 0)) continue;
      const up = b.d > 0, win = up ? b.a : b.b, lose = up ? b.b : b.a; if (!(win.avgR > 0)) continue;
      F.push({st, k: c.k, ag: c.ag, t: b.t, up, txt: `${c.lab} ${up ? '≥' : 'under'} ${critFmt(c, b.t)}`, ev: `${fmtR(win.avgR)} over ${win.n} trades vs ${fmtR(lose.avgR)} over ${lose.n}`});
    }
    (CRIT_SIGNS[st] || []).forEach((lab, i) => {
      const r = critSign(T, i); if (r.a.n < CRIT_SIDE || r.b.n < CRIT_SIDE || Math.abs(r.d) < CRIT_EDGE || Math.abs(r.ts) < CRIT_T) return;
      if (!critHoldsDir(T.filter(x => x.cx.sg && x.cx.sg[i] != null), x => x.cx.sg[i] === 1, r.d > 0)) return;
      const up = r.d > 0, win = up ? r.a : r.b, lose = up ? r.b : r.a; if (!(win.avgR > 0)) return;
      F.push({st, k: 'sg' + i, ag: i === 6 && st !== 'smc' ? 'ivy' : [2, 3, 5].includes(i) && st !== 'smc' ? 'flo' : 'scout', sg: i, up, txt: `${lab}: ${up ? 'present' : 'absent'}`, ev: `${fmtR(win.avgR)} over ${win.n} trades vs ${fmtR(lose.avgR)} over ${lose.n}`});
    });
  }
  RV.prof = {t: now(), n, F};
  return RV.prof;
}
// how a coin looks against the profile right now, for one strategy
function profFit(s, st) {
  const F = ((RV.prof || {}).F || []).filter(f => f.st === st); if (!F.length) return null;
  const chk = st === 'rev' ? (S.trC.get(s) || {}).checks : st === 'mom' ? (S.moC.get(s) || {}).checks : (S.smC && S.smC.get(s) || {}).checks;
  const cx = entryCtx(s, chk), hit = [], miss = [], unk = [];
  for (const f of F) {
    const v = f.sg != null ? (cx.sg[f.sg] == null ? null : cx.sg[f.sg]) : cx[f.k];
    if (v == null) { unk.push(f); continue; }
    const ok = f.sg != null ? (f.up ? v === 1 : v === 0) : (f.up ? v >= f.t : v < f.t);
    (ok ? hit : miss).push(f);
  }
  return {hit, miss, unk, of: F.length};
}
/* ---- the screening loop: Reviewer → screening agents → traders ---- */
// When a criterion is published or lifted, the Reviewer tells the agent that screens on it; that agent applies it as a
// screen (✓/✗ per coin) and replies; the trader that runs the strategy replies with how it will use it. The traders
// then skip coins that fail a published screen and take the best fits first, except 1 in 5 failing coins, which is
// still traded as a "screen test" so the Reviewer keeps measuring whether the screen still matters.
const AGN = {scout: 'GainerLoser', ivy: 'OpenInterest', flo: 'Flow', trader: 'Trader', smc: 'SMC Trader', rev: 'Reviewer'};
const scrKey = f => [f.st, f.k, f.up ? 1 : 0, f.t == null ? '' : f.t].join(':');
const scrUse = st => st === 'smc' ? !!SM.cfg.useScreens : !!PT.cfg.useScreens;
function rvMemo(from, to, txt) {
  RV.memos = RV.memos || []; RV.memos.unshift({t: now(), from, to, txt}); if (RV.memos.length > 80) RV.memos.length = 80;
  raise(from, 'ACCOUNT', 'memo' + now() + Math.random(), `→ ${AGN[to] || to}: ${txt}`, 0, 0);
}
function screenTalk(oldF, newF) {
  const O = new Map(oldF.map(f => [scrKey(f), f])), N = new Map(newF.map(f => [scrKey(f), f])), movers = [...S.gainers, ...S.losers];
  for (const [k, f] of N) if (!O.has(k) && (f.st !== 'smc' || scrUse('smc'))) {
    const who = f.st === 'smc' ? 'smc' : 'trader', strat = STRAT_NOUN[f.st];
    rvMemo('rev', f.ag, `For ${strat}, screen for "${f.txt}". Evidence: ${f.ev}.`);
    const pass = movers.filter(s => { const r = profFit(s, f.st); return r && r.hit.some(h => scrKey(h) === k); }).length;
    rvMemo(f.ag, 'rev', `Done. I now mark coins ✓/✗ on "${f.txt}" for ${strat}. ${pass} of the current top-10 movers pass.`);
    rvMemo(who, 'rev', scrUse(f.st) ? `Understood. For ${strat} I'll skip setups that fail "${f.txt}" and take the best fits first. 1 in 5 that fail still gets traded as a test, so you can keep checking it.` : `Noted, but the Reviewer's screens are switched off on my desk, so I'm not using it.`);
  }
  for (const [k, f] of O) if (!N.has(k) && (f.st !== 'smc' || scrUse('smc'))) {
    const who = f.st === 'smc' ? 'smc' : 'trader', strat = STRAT_NOUN[f.st];
    rvMemo('rev', f.ag, `Lift the "${f.txt}" screen for ${strat}: the newer trades no longer back it.`);
    rvMemo(f.ag, 'rev', `Lifted. "${f.txt}" no longer counts for ${strat}.`);
    if (scrUse(f.st)) rvMemo(who, 'rev', `OK, "${f.txt}" no longer filters my ${strat}.`);
  }
}
// the traders ask this for each candidate: skip it, take it, or take it as a screen test
function screenGate(s, st) {
  if (!scrUse(st)) return null;
  const f = profFit(s, st); if (!f) return null;
  if (!f.miss.length) return {fit: f};
  RV.scrN = RV.scrN || {}; RV.scrDec = RV.scrDec || {};
  const k = st + ':' + s; let d = RV.scrDec[k];
  if (!d || now() - d.t > 6 * 3600e3) { RV.scrN[st] = (RV.scrN[st] || 0) + 1; d = RV.scrDec[k] = {t: now(), test: RV.scrN[st] % 5 === 0}; }
  for (const x in RV.scrDec) if (now() - RV.scrDec[x].t > 24 * 3600e3) delete RV.scrDec[x];
  if (d.test) return {fit: f, test: true};
  return {fit: f, skip: `${AGN[f.miss[0].ag]} screen: fails "${f.miss[0].txt}"${f.miss.length > 1 ? ` (+${f.miss.length - 1} more)` : ''}`};
}
const scrRec = c => c.scr ? {fit: c.scr.fit.hit.length + '/' + c.scr.fit.of, test: !!c.scr.test, miss: c.scr.fit.miss.map(f => f.txt)} : null;
// keep the profile current and tell GainerLoser when a top-5 mover fits it fully
function profTick() {
  const nT = critTrades('rev').length + critTrades('mom').length + critTrades('smc').length;
  if (!RV.prof || RV.prof.nT !== nT) { const prev = RV.prof; rvProfile(); RV.prof.nT = nT; if (prev) screenTalk(prev.F || [], RV.prof.F); rvSave(); }
  const nY = Object.keys(RVM).length + ':' + Object.values(RVM).reduce((a, m) => Math.max(a, m.t || 0), 0) + ':' + SM.log.length + ':' + SM.log.filter(x => x.q).length + ':' + SM.log.filter(x => x.fu).length + ':' + SM.log.filter(x => x.zc && x.zc.done).length;
  if (RV.smKey !== nY) { RV.smKey = nY; smLearn(); rvSave(); }
  if (!RV.prof.F.length) return;
  for (const s of [...S.gainers, ...S.losers]) for (const st of ['rev', 'mom', 'smc']) {
    if (st === 'rev' && sideOf(s) === 'L' && !PT.cfg.revLong) continue;
    const f = profFit(s, st); if (!f || f.of < 2 || f.hit.length < f.of) continue;
    const key = s + ':' + st; RV.fitSeen = RV.fitSeen || {}; if (now() - (RV.fitSeen[key] || 0) < 12 * 3600e3) continue; RV.fitSeen[key] = now(); rvSave();
    raise('scout', s, 'fit' + st, `${base(s)} fits all ${f.of} of the Reviewer's winning criteria for ${CRIT_STRAT[st].toLowerCase()}: ${f.hit.map(x => x.txt).join('; ')}`, sideOf(s) === 'G' ? 1 : -1, 0, true);
  }
}

/* ================= REVIEWER: screens + panel ================= */
TABS.rev = [['rev', 'Latest review'], ['chart', 'On the chart'], ['smcr', 'SMC review'], ['tf', 'Timeframes'], ['crit', 'Criteria'], ['talk', 'Screening talk'], ['rules', 'Rules in force'], ['grades', 'Trade grades'], ['hist', 'History & settings']];
const GRADE_C = {A: UP, B: '#7fe3b8', C: DIM, D: WARN, F: DN, '—': DIM};
const RV_ST = {pending: ['Waiting for the Trader to read it', WARN], accepted: ['Trader accepted all changes', UP], adjusted: ['Trader accepted with adjustments', '#4dd2ff']};
function drawReviewerScreens(d) {
  const [A, B] = d.mons, col = d.a.color, rv = RV.reviews[0];
  let c = screenFrame(A, col, rv ? `REVIEW #${rv.id} · ${rv.n} TRADES` : 'TRADE REVIEW', rv ? ago(rv.t) + ' ago' : (RV.on ? 'WATCHING' : 'OFF'));
  if (!rv) {
    const n = PT.log.filter(x => !rvManual(x)).length;
    c.font = `800 30px ${FS}`; c.fillStyle = TXT; c.fillText('Waiting for trades', 16, 110);
    c.font = `500 19px ${FS}`; c.fillStyle = DIM; c.fillText(`First review after 3 closed trades (${n} so far).`, 16, 150);
    c.fillText('Every trade gets a grade the moment it closes.', 16, 180);
  } else {
    c.font = `800 46px ${FM}`; c.fillStyle = tone(rv.O.avgR); c.fillText(fmtR(rv.O.avgR), 16, 98);
    c.font = `600 19px ${FM}`; c.fillStyle = DIM; c.fillText(`avg / trade · ${rv.O.win.toFixed(0)}% win · PF ${rv.pf == null ? '∞' : rv.pf.toFixed(2)}`, 16, 132);
    let x = 16; for (const g of ['A', 'B', 'C', 'D', 'F']) { c.font = `800 26px ${FS}`; c.fillStyle = GRADE_C[g]; c.fillText(g, x, 178); c.font = `700 24px ${FM}`; c.fillStyle = TXT; c.fillText(String(rv.grades[g] || 0), x + 24, 178); x += 110; }
    c.font = `500 17px ${FS}`;
    rv.F.slice(0, 4).forEach((f, i) => { c.fillStyle = f.t === 'good' ? UP : f.t === 'bad' ? DN : DIM; c.fillText('●', 16, 222 + i * 52); c.fillStyle = '#c3cde6'; wrapText(c, f.d, 40, 222 + i * 52, 740, 22, 2); });
  }
  A.tex.needsUpdate = true;
  const st = rv ? RV_ST[rv.status] : null;
  c = screenFrame(B, col, 'RULE CHANGES → TRADER', st ? st[0].toUpperCase().slice(0, 30) : '');
  if (!rv) { c.font = `500 19px ${FS}`; c.fillStyle = DIM; c.fillText('No review yet.', 16, 110); }
  else if (!rv.changes.length) { c.font = `700 24px ${FS}`; c.fillStyle = UP; c.fillText('No changes. Rules are working.', 16, 110); }
  else {
    const L = (rv.trader ? rv.trader.changes : rv.changes).slice(0, 6);
    L.forEach((ch, i) => {
      const y = 96 + i * 54, a = ch.a || 'wait', ic = a === 'ok' ? '✓' : a === 'wait' ? '…' : '↺';
      c.font = `800 24px ${FS}`; c.fillStyle = a === 'ok' ? UP : a === 'wait' ? WARN : '#4dd2ff'; c.fillText(ic, 16, y);
      c.font = `600 18px ${FS}`; c.fillStyle = TXT; wrapText(c, ch.txt, 48, y, 730, 22, 2);
    });
    if (rv.changes.length > 6) { c.font = `500 16px ${FS}`; c.fillStyle = DIM; c.fillText(`+${rv.changes.length - 6} more in the panel`, 48, 430); }
  }
  B.tex.needsUpdate = true;
}
function rvGroupTable(title, g) {
  const rows = Object.entries(g).sort((a, b) => b[1].n - a[1].n);
  if (!rows.length) return '';
  return `<h3 style="margin-top:10px">${title}</h3><table class="t"><thead><tr><th style="text-align:left">Group</th><th>Trades</th><th>Win</th><th>Avg</th><th>Total</th></tr></thead><tbody>${rows.map(([k, a]) => `<tr><td style="text-align:left;font-family:var(--sans)">${esc(k)}</td><td>${a.n}</td><td>${a.win.toFixed(0)}%</td><td class="${cls(a.avgR)}">${fmtR(a.avgR)}</td><td class="${cls(a.sum)}">${fmtR(a.sum)}</td></tr>`).join('')}</tbody></table>`;
}
function reviewerHTML(tab) {
  const rv = RV.reviews[0], k = (l, v, cl = '') => `<div class="kpi"><span>${l}</span><b class="${cl}">${v}</b></div>`;
  const nT = PT.log.filter(x => !rvManual(x)).length, fresh = PT.log.filter(x => x.t1 > RV.lastT && !rvManual(x)).length;
  const head = `<div class="card2" style="margin-bottom:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;border-left:4px solid ${RV.on ? '#c5f05a' : DIM}">
    <b style="color:${RV.on ? '#c5f05a' : DIM}">${RV.on ? (RV.active ? 'Reviewer\'s rules are active' : 'Reviewer is watching. No rule changes yet.') : 'Reviewer adjustments are OFF. The Trader uses only your settings.'}</b>
    <span class="dim" style="font-size:12px">${RV.auto ? `auto-review every ${RV.every} closed trades (${fresh} since the last one)` : 'auto-review off'} · ${nT} trades graded</span>
    <span style="margin-left:auto;display:flex;gap:8px"><button class="btn sm" data-rv="run">Run review now</button><button class="btn sm ghost" data-rv="toggle">${RV.on ? 'Turn adjustments off' : 'Turn adjustments on'}</button></span></div>
    ${RV._msg ? `<p class="note" style="color:${WARN}">${esc(RV._msg)}</p>` : ''}`;
  if (tab === 'chart') return head + rvChartHTML();
  if (tab === 'tf') return head + rvTfHTML();
  if (tab === 'smcr') return head + rvSmcHTML();
  if (tab === 'crit') return head + rvCritHTML();
  if (tab === 'talk') return head + rvTalkHTML();
  if (tab === 'rules') return head + rulesBothHTML();
  if (tab === 'grades') {
    if (!PT.log.length) return head + '<div class="empty">No closed trades yet. Each trade is graded as soon as it closes: A/B for working trades, C for scratches and clean planned losses, D for avoidable mistakes, F for losses beyond the plan.</div>';
    return head + `<table class="t"><thead><tr><th>Closed</th><th>Coin</th><th>Side</th><th>Grade</th><th>R</th><th>Best R</th><th>Signs</th><th>Stage</th><th style="text-align:left">Reviewer's note</th><th style="text-align:left">Lessons in force</th></tr></thead><tbody>${PT.log.slice(0, 150).map(x => { const g = x.g || rvGrade(x); return `<tr data-sym="${x.s}"><td class="dim">${new Date(x.t1).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</td><td class="sym">${esc(x.b)}</td><td class="${x.side === 'L' ? 'up' : 'dn'}">${x.side === 'L' ? 'LONG' : 'SHORT'}${x.strat === 'mom' ? '<br><span class="tag" style="color:#7fe3b8">momentum</span>' : ''}</td><td><b style="color:${GRADE_C[g.g]};font-size:15px">${g.g}</b></td><td class="${cls(x.R)}">${fmtR(x.R)}</td><td class="dim">${(x.maxR || 0).toFixed(1)}</td><td class="dim">${fin(x.sc) ? x.sc + '/8' : '—'}</td><td class="dim">${rvStage(x) === 'done' ? 'Reversed' : 'Forming'}</td><td style="text-align:left;white-space:normal;min-width:240px;font-family:var(--sans);font-size:12px">${esc(g.note)}${x.post && x.post.chk ? `<br><span class="${x.post.hit ? 'dn' : 'dim'}">${x.post.hit ? 'After the stop, price went on to hit +1.5R' : 'After the stop, price did not recover to +1.5R'}</span>` : ''}</td><td style="text-align:left;white-space:normal;min-width:160px;font-family:var(--sans);font-size:11px" class="dim">${x.les && x.les.length ? esc(x.les.join(' · ')) : '—'}</td></tr>`; }).join('')}</tbody></table>`;
  }
  if (tab === 'hist') {
    const set = `<div class="card2" style="margin-bottom:12px"><h3>SETTINGS</h3><div class="set" style="grid-template-columns:1fr 1fr 1fr">
      <label>Auto-review<select data-rvcfg="auto"><option value="1" ${RV.auto ? 'selected' : ''}>On</option><option value="0" ${RV.auto ? '' : 'selected'}>Off</option></select></label>
      <label>Review every N closed trades<input type="number" data-rvcfg="every" min="1" max="50" step="1" value="${RV.every}"></label>
      <label>&nbsp;<button class="btn sm ghost" data-rv="clear">${RV._arm ? 'Click again to clear all lessons' : 'Clear lessons (back to your settings)'}</button></label></div>
      <p class="note" style="margin-top:8px">The Reviewer works only from the Trader's last ${RV_WIN} closed trades and needs a minimum sample before any change: 3 trades for a setup, 4 for a side, 6 for the whole account. It can make rules stricter or smaller, or relax them back to <b>your</b> settings. It never raises risk above what you set on the Trader's desk. Trades you close by hand are left out.</p></div>`;
    if (!RV.reviews.length) return head + set + '<div class="empty">No reviews yet.</div>';
    return head + set + RV.reviews.map(r => { const s = RV_ST[r.status]; return `<div class="card2" style="margin-bottom:10px;border-left:4px solid ${s[1]}"><div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap"><b>Review #${r.id}</b><span class="dim" style="font-size:12px">${new Date(r.t).toLocaleString()} · ${r.n} trades${r.manual ? ' · run by you' : ''}</span><span class="${cls(r.O.avgR)} mono">${fmtR(r.O.avgR)} avg · ${r.O.win.toFixed(0)}% win</span><span style="margin-left:auto;color:${s[1]};font-size:12px">${s[0]}</span></div>
      ${r.changes.length ? (r.trader ? r.trader.changes : r.changes).map(c => `<div class="chk" style="padding:3px 0"><span class="i" style="color:${c.a === 'ok' ? UP : c.a ? '#4dd2ff' : WARN}">${c.a === 'ok' ? '✓' : c.a ? '↺' : '…'}</span><span>${esc(c.txt)}</span></div>`).join('') : '<div class="dim" style="font-size:12px;margin-top:6px">No rule changes.</div>'}</div>`; }).join('');
  }
  // latest review
  if (!rv) return head + `<div class="empty">No review yet. The first one runs after 3 closed trades (${nT} so far)${nT >= 3 ? '. Click "Run review now"' : ''}. Meanwhile every trade is graded on the "Trade grades" tab.</div>` + rvLessonsCard();
  const s = RV_ST[rv.status], tr = rv.trader;
  const chRows = (tr ? tr.changes : rv.changes).map(c => `<div class="chk" style="align-items:flex-start;padding:7px 0"><span class="i" style="color:${c.kind === 'lifted' ? UP : '#c5f05a'}">${c.kind === 'lifted' ? '↓' : c.kind === 'new' ? '+' : '~'}</span><span><b>${esc(c.txt)}</b>${c.why ? `<br><span class="dim" style="font-size:12px">Why: ${esc(c.why)}</span>` : ''}${tr ? `<br><span style="font-size:12px;color:${c.a === 'ok' ? UP : '#4dd2ff'}">Trader: ${esc(c.note || '')}</span>` : ''}</span></div>`).join('');
  return head + `<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">${k('Review', '#' + rv.id + ' · ' + ago(rv.t))}${k('Trades', rv.n)}${k('Win rate', rv.O.win.toFixed(0) + '%')}${k('Avg / trade', fmtR(rv.O.avgR), cls(rv.O.avgR))}${k('Profit factor', rv.pf == null ? '∞' : rv.pf.toFixed(2))}${k('Grades', `<span style="display:flex;gap:10px">${['A', 'B', 'C', 'D', 'F'].map(g => `<span style="color:${GRADE_C[g]}">${g}&nbsp;${rv.grades[g] || 0}</span>`).join('')}</span>`)}</div>
  <div class="grid2"><div class="card2"><h3>WHAT THE NUMBERS SAY</h3>${rv.F.map(f => `<div class="chk"><span class="i" style="color:${f.t === 'good' ? UP : f.t === 'bad' ? DN : DIM}">●</span><span>${esc(f.d)}</span></div>`).join('')}
    ${rv.G.strat ? rvGroupTable('BY STRATEGY', rv.G.strat) : ''}${rvGroupTable('BY SIDE', rv.G.side)}${rvGroupTable('BY SETUP TAG', rv.G.tag)}${rvGroupTable('BY ENTRY STAGE', rv.G.stage)}${rvGroupTable('BY SIGNS AT ENTRY', rv.G.score)}${rv.G.unl ? rvGroupTable('BY TOKEN UNLOCK AT ENTRY', rv.G.unl) : ''}${rvGroupTable('BY EXIT', rv.G.exit)}</div>
  <div><div class="card2"><h3>RULE CHANGES SENT TO THE TRADER <span style="float:right;color:${s[1]};letter-spacing:0">${s[0]}</span></h3>${chRows || '<div class="dim" style="font-size:13px;padding:6px 0">No changes. Nothing in the sample justifies one.</div>'}</div>
  ${tr ? `<div class="card2" style="margin-top:12px;border-left:4px solid #ffd166"><h3 style="color:#ffd166">TRADER'S REPLY · ${ago(tr.t)} ago</h3>
    ${tr.changes.filter(c => c.a !== 'ok').map(c => `<div class="chk"><span class="i" style="color:#4dd2ff">↺</span><span><b>${esc(c.txt)}</b><br><span style="font-size:12px">${esc(c.note)}</span></span></div>`).join('') || '<div class="chk"><span class="i up">✓</span><span>Accepted every change as written.</span></div>'}
    <p style="font-size:13px;margin:10px 0 4px"><b>What-if on the last 24h:</b> ${tr.sim.n ? `of ${tr.sim.n} reversal candidates, <b>${tr.sim.before}</b> qualified under the old rules and <b>${tr.sim.after}</b> qualify under the new ones.${tr.sim.lost.length ? ` Now skipped: ${tr.sim.lost.map(esc).join(', ')}.` : ''}${tr.sim.gained.length ? ` Now allowed: ${tr.sim.gained.map(esc).join(', ')}.` : ''}` : 'no candidates recorded yet to test against.'}</p>
    <h3 style="margin-top:10px">MY PLAN FOR THE NEXT ENTRIES</h3>${tr.plan.map(l => `<div class="chk"><span class="i up">›</span><span>${esc(l)}</span></div>`).join('')}</div>` : `<div class="card2" style="margin-top:12px"><span class="dim">The Trader pauses new entries and reads this review on its next scan.</span></div>`}</div></div>`;
}
// the Trader's "Lessons" card (shown on the Trader's account tab too)
function rvLessonsCard() {
  const A = ptLessons(), I = rvItems(A), rv = A && RV.reviews.find(r => r.id === A.id);
  const ks = Object.keys(I);
  return `<div class="card2" style="margin-top:14px;border-left:4px solid #c5f05a"><h3 style="color:#c5f05a">LESSONS FROM THE REVIEWER${rv ? ` · review #${rv.id}, ${ago(rv.t)} ago` : ''}</h3>
  ${!RV.on ? '<span class="dim" style="font-size:13px">Reviewer adjustments are off. Trading on your settings only.</span>' : RV.pending ? `<span style="font-size:13px;color:${WARN}">A new review (#${RV.pending}) is waiting. The Trader reads it before its next entry.</span>` : ks.length ? ks.map(k => `<div class="chk"><span class="i" style="color:#c5f05a">•</span><span>${esc(I[k])}</span></div>`).join('') + (rv && rv.trader ? `<h3 style="margin-top:8px">TRADER'S PLAN</h3>${rv.trader.plan.map(l => `<div class="chk"><span class="i up">›</span><span>${esc(l)}</span></div>`).join('')}` : '') : '<span class="dim" style="font-size:13px">No changes in force. Trading on your settings.</span>'}</div>`;
}
document.getElementById('panel').addEventListener('click', e => {
  const b = e.target.closest('[data-rv]'); if (!b) return; e.stopPropagation();
  if (syBlock()) return;
  const a = b.dataset.rv; RV._msg = '';
  if (a === 'run') { if (RV.pending) RV._msg = `Review #${RV.pending} is still waiting for the Trader.`; else { const m = rvRun(true); if (m) RV._msg = m; } }
  if (a === 'toggle') { RV.on = !RV.on; sayFor('rev', RV.on ? 'Back on. The Trader trades with my lessons again.' : 'Adjustments off. The Trader uses your settings only.'); }
  if (a === 'clear') { if (RV._arm) { RV._arm = false; RV.active = null; RV.pending = null; sayFor('rev', 'Lessons cleared. Back to your settings.'); } else { RV._arm = true; setTimeout(() => { RV._arm = false; }, 6000); } }
  rvSave(); renderPanel();
}, true);
document.getElementById('panel').addEventListener('change', e => {
  const i = e.target.closest('[data-rvcfg]'); if (!i) return;
  if (syBlock()) return;
  if (i.dataset.rvcfg === 'auto') RV.auto = i.value === '1';
  if (i.dataset.rvcfg === 'every') { const v = Math.round(+i.value); if (v >= 1) RV.every = v; }
  rvSave();
});

# SMC Year Backtester (agent 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each night, re-run the SMC strategy (SMC Big settings) over the last 365 days on BTCUSDT and ETHUSDT. Add a one-switch-per-rule ablation and an automatic pattern finder with a two-halves check, and show the results read-only as desk agent 7, "Backtester".

**Architecture:** `bot/backtest-year.mjs` loads BTC/ETH candles, builds its own hourly universe, and runs `simulate()` from `bot/backtest.mjs` as the SB account. That is one base run, one raw run and up to 10 ablation runs. Then it attaches entry features to every trade. `bot/year-report.mjs` holds the pure statistics: stats, pattern finder, ablation labels, months, exits and the size guard. `bot/backtest.mjs` main() calls the year run after the 7-day runs and writes `smc-backtest-year.json` in the same parentless commit on branch `backtest`. The desk reads that file in `src/sync.js`, and the new `src/bt_ui.js` renders the panel and the desk screens.

**Tech Stack:** Node 22 ESM, `node:vm` over the built `bot/core.js`, plain browser JS in `src/` (built by `build.py`), three.js 0.149 desk, Playwright smoke test. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-smc-year-backtester-design.md`

## Global Constraints

- **Report only.** Never change live rules: "no apply button, no input to `smLearn`, `smZoneTune`, `RV.smAdj`, SM / SB cfg". The only live-code change allowed is `SM.cfg.regimeGate`, which defaults to 1 and is proven default-preserving.
- **Coins.** BTCUSDT and ETHUSDT only. Keep the coin list as one constant (`YEAR_COINS`), so that adding SOL later is a one-line change.
- **Settings.** SMC Big settings: `SM.cfg` from the live state + `SB_OV`, the current `RV.smAdj` minus `zone`, and `zoneLearn` 0.
- **Account and fills.** One fresh $1,000 account trades both coins, with the same 3-position and 10× caps as live. 5m steps, with the same fills, fees and slippage as the 7-day backtest.
- **Halves.** Discovery = the first 8 months and check = the last 4 months. The split time is `tSplit = from + (to - from) * 8 / 12`. A trade belongs to a half by its `t0`.
- **Pattern thresholds.** n ≥ 20 for each side, and avg R differs by ≥ 0.3R. In the check half, each side needs n ≥ 8 and the same direction. "Did not hold" is capped at 10.
- **Ablation label.** A rule is helpful or harmful only if Δ avg R ≥ 0.2R and the same sign holds in both halves. Otherwise it is "no clear effect". Sort by label first, then by |Δ total R|.
- **Raw run.** `RV.smAdj` emptied and `minQ` at the `SM_DEF` default, with the regime gate on. The pattern finder uses only the raw run. The headline numbers and the ablation use the rules-in-force base run, and the panel labels which run each number comes from.
- **No funding.** The backtest has no funding data. The report says so in one line.
- **Leave the nightly files alone.** `smc-backtest.json` and `smc-backtest-big.json` keep their names, schema and contents.
- **File size.** The results file stays under 1 MB (guard at 900 000 bytes of JSON).
- **Time zone.** Runs in `TZ=America/Creston`. Hour bands and weekdays are in **UTC** (`getUTCHours` / `getUTCDay`).
- **No trade data in the repo.** Never commit trade data, a state file or a backtest output to this public repo. Tests use only synthetic fixtures. A local `STATE_IN` file lives outside the repo.
- **No new dependencies.** No change to the cloud trader (`bot/run.mjs`) or its 5-min run.
- **Build.** Edit `src/` only, then run `PYTHONUTF8=1 py -3 build.py` (`python` is not on PATH). Commit the source together with the built `index.html` and `bot/core.js`. Never hand-edit the built files. `src/*` files are CRLF, so keep CRLF, including in the new `src/bt_ui.js`.
- **Shell.** Windows with the Bash tool. Code, comments and commits in English.
- **Commits.** Commit at the end of each task. Do **not** push; the main thread pushes after review (`git pull --rebase` first, because the unlock calendar commit lands every morning).

## Review Focus

1. **BTC or ETH moves ≥ 8% in 24 h**, which would put it in the small-cap tracker. Expected: it stays in the year universe and keeps trading, because the year mode's `trk` is always `{}`. Test: Task 3, `yearHour` with BTC +40%.
2. **Process TZ is America/Creston, but the hour bands and weekday are UTC.** Expected: a trade at 13:00 UTC lands in `NY` and a trade at 12:59 UTC lands in `London`, whatever the local time. Test: Task 3, `feats` checks.
3. **First night: no year file yet (404), or Sync not set.** Expected: the Backtester panel shows a plain message, the screens say "no year run yet", and there are no page errors. Test: Task 5, smoke with `BTS.year = null`.
4. **A run with 0 trades** (short window, or a switch that blocks everything). Expected: `avgR`/`win` are null, there is no NaN in the JSON, the ablation label is `none`, and the panel shows "—". Test: Task 2, empty-input checks.
5. **The year run is slower than the job allows.** Expected: the 7-day nightly files are still written. Ablations not started before the deadline are listed as skipped with "out of time". Test: Task 4, local run with `BT_DEADLINE_MIN=0`.

---

### Task 1: Regime-gate switch `SM.cfg.regimeGate`

**Files:**
- Modify: `src/smc.js:13` (`SM_DEF.cfg`), `src/smc.js:404` (`smcRead` rank), `src/smc.js:633` (`smTick` skip)
- Test: `tests/smc-regime.mjs` (extend, after line 75)
- Built: `index.html`, `bot/core.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `SM.cfg.regimeGate`, a number. `1` (the default, also when the key is missing) means today's behaviour. `0` means the regime skip is off and so is the −500 rank penalty for a regime that doesn't fit. The scoring items (`smGrade` 'htf', the quality `add('htf', …)`, the check line at :468) stay unchanged. Continuation setups still only form in up/down regimes (:416), because that is setup generation, not a gate.

- [ ] **Step 1: Write the failing test.** Append to `tests/smc-regime.mjs` right after the "skip reason mentions the regime" check (line 75). Reuse the same falling-1h fixture:

```js
check(X('SM_DEF.cfg.regimeGate') === 1, 'SM_DEF.cfg.regimeGate defaults to 1');
X('SM.cfg.regimeGate = 0; S.smC.clear(); SM.cool = {}; smTick();');
const scan0 = JSON.parse(X('JSON.stringify(SM.lastScan)'));
check(!scan0.cands.some(c => /regime/.test(c.skip || '')), 'regimeGate 0: no skip mentions the regime', scan0);
X('SM.cfg.regimeGate = 1; for (const s of Object.keys(SM.pos)) delete SM.pos[s]; SM.log = []; S.smC.clear(); SM.cool = {}; smTick();');
check(JSON.parse(X('JSON.stringify(SM.lastScan)')).cands.some(c => c.side === 'L' && /regime/.test(c.skip)), 'regimeGate 1: regime skip back (default-preserving)');
X('for (const s of Object.keys(SM.pos)) delete SM.pos[s]; SM.log = []; S.smC.clear(); SM.cool = {};');
```

- [ ] **Step 2: Run it to verify it fails.** Run `PYTHONUTF8=1 py -3 build.py && node tests/smc-regime.mjs`. Expected: `FAIL SM_DEF.cfg.regimeGate defaults to 1`.
- [ ] **Step 3: Implement.** Add `regimeGate: 1` to `SM_DEF.cfg`. At :633 the condition becomes `else if (SM.cfg.regimeGate !== 0 && (!r.rok || !r.rok.ok))`. At :404 the penalty becomes `(r.against || (SM.cfg.regimeGate !== 0 && r.rok && !r.rok.ok) ? -500 : 0)`. Add a one-line comment: `// regimeGate 0 only for the year backtest's ablation (Nov 14); live stays 1`.
- [ ] **Step 4: Run the tests to verify they pass.** Run `PYTHONUTF8=1 py -3 build.py && node tests/smc-regime.mjs && node tests/smc-sweep.mjs && node tests/smc-bigcap.mjs && node tests/smc-zones.mjs`. Expected: every script prints PASS.
- [ ] **Step 5: Commit.** `git add src/smc.js tests/smc-regime.mjs index.html bot/core.js && git commit -m "SMC: regimeGate switch (default 1, for the year backtest ablation)"`

---

### Task 2: Pure report module `bot/year-report.mjs`

**Files:**
- Create: `bot/year-report.mjs`
- Test: `tests/year-report.mjs`

**Interfaces:**
- Consumes: nothing. The module is pure, with no imports.
- Produces:
  - `Row = {v, s, side, t0, t1, R, why, f: {coin, side, type, tf, zone, qBand, grade, regime, hour, wd, atr, mv, atrT, mvT, rrBand, stopBand, btc}}` (from Task 3).
  - Constants: `MIN_N = 20, MIN_DR = 0.3, MIN_N_CHECK = 8, NOT_HELD_CAP = 10, ABL_DR = 0.2, SIZE_MAX = 900e3`.
  - `FEATS = ['coin','side','type','tf','zone','qBand','grade','regime','hour','wd','atrT','mvT','rrBand','stopBand','btc']`.
  - `stats(rows) → {n, avgR, win, totR, maxDD}`:
    - `avgR` is rounded to 3 dp, and `win` is a percentage rounded to an integer. Both are `null` when n = 0.
    - `totR` and `maxDD` are rounded to 2 dp and are 0 when n = 0.
    - `maxDD` is the largest peak-to-trough fall of cumulative R, ordered by `t1`, with the peak starting at 0.
  - `sumRun(rows, tSplit) → {all, a, b, coin: {[s]: stats}}`. `a` holds the rows with `t0 < tSplit` and `b` holds the rest.
  - `findPatterns(rows, tSplit) → {held: Pat[], notHeld: Pat[]}`, where `Pat = {f, v, dA, dB, inA, inB, outA, outB}`:
    - `in*` and `out*` are `{n, avgR}`, and `d* = in.avgR − out.avgR`.
  - `ablation(baseRows, runs: [{k, lab, rows}], tSplit) → AblRow[]`:
    - `AblRow = {k, lab, base: {all, a, b}, sw: {all, a, b}, dAvg, dA, dB, dTot, label}`.
    - `label` is one of `'helpful' | 'harmful' | 'none'`, and it describes **the live (base) setting**.
  - `months(rows) → [{m: 'YYYY-MM', n, avgR}]`, using the UTC month of `t0`, ascending.
  - `exits(rows) → [{why, n, avgR}]`. `why = String(why).replace(/[\d.]+/g, '#').slice(0, 40)`, sorted by n descending.
  - `terciles(rows, key, out)` sets `row.f[out]` to `'low' | 'mid' | 'high'` by rank among the m non-null `row.f[key]` values: rank < m/3 is low, rank < 2m/3 is mid, the rest is high. Equal values share the label of the lowest rank. A null value gets `'?'`.
  - `fitSize(file) → file`: if `JSON.stringify(file).length > SIZE_MAX`, keep the last 100 `trades` per `v` (by `t0`), then 0. It sets `file.sum.trimmed = true` when it trims.

Algorithms the signatures don't determine:
- **Patterns.**
  - For each feature in `FEATS`, take every distinct value `v`, except `'?'`, `null` and `undefined`. When a feature has exactly 2 values, test only the first in sorted order, so there are no mirrored duplicates. The split is `in` (`f[feat] === v`) against `out` (the rest).
  - It **passes discovery** if, in half A, `in` and `out` each have n ≥ `MIN_N` and `|dA| ≥ MIN_DR`.
  - It is **held** if, in half B, `in` and `out` each have n ≥ `MIN_N_CHECK` and `Math.sign(dB) === Math.sign(dA)`.
  - A split that passes discovery but fails the check goes to `notHeld`.
  - Both lists are sorted by `|dA|` descending, and `notHeld` is cut to `NOT_HELD_CAP`.
- **Ablation.**
  - Take the deltas `sw − base` of avgR overall (`dAvg`), in half A (`dA`) and in half B (`dB`). `dTot` is the delta of `totR` overall.
  - `harmful` (the switch is better): `dAvg ≥ ABL_DR && dA > 0 && dB > 0`.
  - `helpful` (the live setting is better): `dAvg ≤ −ABL_DR && dA < 0 && dB < 0`.
  - Any null avgR gives `'none'`.
  - Sort with labels other than `'none'` first, then by `|dTot|` descending.

- [ ] **Step 1: Write the failing test.** Create `tests/year-report.mjs` (no network, no core). It has a synthetic row builder `mk(t0, R, f)` with `t1 = t0 + 1`, and uses `tSplit = 1000`. The checks:

```js
// stats + drawdown
eq(stats([]), {n: 0, avgR: null, win: null, totR: 0, maxDD: 0});
eq(stats([mk(1, 1), mk(2, -2), mk(3, 0.5), mk(4, -1)]).maxDD, 2.5);
// held pattern: side L better in both halves
const held = [...rep(25, i => mk(i, 0.5, {side: 'L'})), ...rep(25, i => mk(i, -0.2, {side: 'S'})), ...rep(10, i => mk(2000 + i, 0.4, {side: 'L'})), ...rep(10, i => mk(2000 + i, -0.1, {side: 'S'}))];
const P = findPatterns(held, 1000);
ok(P.held.length === 1 && P.held[0].f === 'side' && Math.abs(P.held[0].dA - 0.7) < 1e-9 && P.held[0].inB.n === 10, 'side split held, tested once');
// flips in the check half -> notHeld; check n 7 -> notHeld; 19 per side in A -> nowhere; dA 0.29 -> nowhere
ok(findPatterns(flipRows, 1000).notHeld.length === 1 && !findPatterns(flipRows, 1000).held.length, 'flip in check half -> did not hold');
ok(findPatterns(check7Rows, 1000).notHeld.length === 1, 'check side n 7 -> did not hold');
ok(!findPatterns(n19Rows, 1000).held.length && !findPatterns(n19Rows, 1000).notHeld.length, 'n 19 per side -> not reported');
ok(!findPatterns(d029Rows, 1000).notHeld.length, 'avg R gap 0.29 -> not reported');
ok(findPatterns(elevenFailing, 1000).notHeld.length === 10, 'did not hold capped at 10');
eq(findPatterns([], 1000), {held: [], notHeld: []});
// ablation labels + sort
const A = ablation(baseRows, [{k: 'x', lab: 'x', rows: swWorseBoth}, {k: 'y', lab: 'y', rows: swBetterOneHalf}, {k: 'z', lab: 'z', rows: swTiny}, {k: 'e', lab: 'e', rows: []}], 1000);
ok(A[0].k === 'x' && A[0].label === 'helpful', 'switch worse by 0.25R in both halves -> live setting helpful, sorted first');
ok(A.find(r => r.k === 'y').label === 'none' && A.find(r => r.k === 'z').label === 'none' && A.find(r => r.k === 'e').label === 'none', 'one-half, < 0.2R, and empty runs -> none');
// months, exits, terciles, size guard, no NaN
eq(months([mk(Date.UTC(2026, 0, 31, 23), 1), mk(Date.UTC(2026, 1, 1), -1)]).map(m => m.m), ['2026-01', '2026-02']);
eq(exits([{...mk(1, 1), why: 'target 3.2R'}, {...mk(2, 0), why: 'target 2.1R'}])[0], {why: 'target #R', n: 2, avgR: 0.5});
const T = rep(9, i => mk(i, 0, {atr: i})); terciles(T, 'atr', 'atrT'); eq(T.map(r => r.f.atrT).join(), 'low,low,low,mid,mid,mid,high,high,high');
const big = fitSize({sum: {}, trades: rep(400, i => ({...mk(i, 0), v: i % 2 ? 'raw' : 'base', pad: 'x'.repeat(3000)}))});
ok(JSON.stringify(big).length <= 900e3 && big.sum.trimmed === true && big.trades.filter(r => r.v === 'raw').length <= 100, 'size guard trims to <= 900 KB');
ok(!/NaN/.test(JSON.stringify([stats([]), sumRun([], 0), ablation([], [], 0)])), 'no NaN on empty input');
```

The implementer builds the fixtures (`flipRows`, `check7Rows`, `n19Rows`, `d029Rows`, `elevenFailing`, `baseRows`, `swWorseBoth`, `swBetterOneHalf`, `swTiny`) in the shape their names state, using the `held` pattern above. `elevenFailing` uses 11 distinct `grade` values, each one failing the check. The test ends with `PASS: year report` or exits 1.
- [ ] **Step 2: Run it to verify it fails.** Run `node tests/year-report.mjs`. Expected: fails with "Cannot find module … year-report.mjs".
- [ ] **Step 3: Implement** `bot/year-report.mjs` with the exports above. Add a header comment: report only, pure, the spec path.
- [ ] **Step 4: Run the test to verify it passes.** Run `node tests/year-report.mjs`. Expected: `PASS: year report`.
- [ ] **Step 5: Commit.** `git add bot/year-report.mjs tests/year-report.mjs && git commit -m "Year backtest: pure report module (patterns, ablation, months, size guard)"`

---

### Task 3: Year run module `bot/backtest-year.mjs`

**Files:**
- Create: `bot/backtest-year.mjs`
- Modify: `bot/backtest.mjs`. Export `aster`, `klines`, `pool`, `simulate` and `row`. Extract the first statement of `simulate`'s setup (lines 114–115, from `SM.cfg = …` through `S.started = 0;`) into `export const PREP` and use it there unchanged. At line 85, change `B.slice(0, n)` to `B.slice(Math.max(0, n - 25), n)`; the result is identical, because the 24 h window holds at most 24 hourly bars, and this removes the O(history²) cost over a year.
- Test: `tests/bt-year.mjs`

**Interfaces:**
- Consumes:
  - Task 1: `SM.cfg.regimeGate`.
  - Task 2: `stats, sumRun, findPatterns, ablation, months, exits, terciles, fitSize`.
  - From `bot/backtest.mjs`: `mkCore(deskCfg, exInfo) → {ctx, X}`, `simulate(name, st, exInfo, D, U, steps, setup, probe, big) → {name, trades, open, …}`, `klines(s, iv, ms, from, to)`, `aster(path)`, `pool(items, n, fn)`, `row(x, v)`, `nClosed`, `tkAt`, `PREP`.
- Produces:
  - `YEAR_COINS = ['BTCUSDT', 'ETHUSDT']` and `YEAR_FILE = 'smc-backtest-year.json'`.
  - `RAW = 'RV.smAdj = {}; SM.cfg.minQ = SM_DEF.cfg.minQ;'`
  - `ABL: {k, lab, sw}[]`. These are the exact `sw` setup strings, run after `PREP`, with `tog = k => \`if (RV.smAdj.${k}) delete RV.smAdj.${k}; else RV.smAdj.${k} = true;\``:
    - `needHTF`, `needPOI`, `needDepth`, `obQ`: `tog(k)`
    - `poiRule`: `SM.cfg.poiRule = SM.cfg.poiRule ? 0 : 1;`
    - `minQ`: `SM.cfg.minQ = SM_DEF.cfg.minQ; delete RV.smAdj.minQ;`. This also lowers the OB bar (`obMinQ = minQ + 10`); say so in its `lab`.
    - `tp1R`: `SM.cfg.tp1R = SM_DEF.cfg.tp1R; delete RV.smAdj.tp1R;`
    - `invExit`: `SB_OV.invExit = SB_OV.invExit ? 0 : 1;`
    - `minStopPct`: `SB_OV.minStopPct = SB_OV.minStopPct === 1 ? 0.5 : 1;`
    - `cont`: `SM.cfg.cont = SM.cfg.cont && !RV.smAdj.noCont ? 0 : 1; if (SM.cfg.cont) delete RV.smAdj.noCont;`
    - `regimeGate`: `SM.cfg.regimeGate = SM.cfg.regimeGate === 0 ? 1 : 0;`
  - `yearHour(H1, h, coins) → {tk, trk: {}, big: string[]}`. `tk[s] = tkAt(H1[s], h)` for the coins that have one, and `big` lists those coins in `coins` order. There is no tracker, so `smBigList` inside `simulate` sees only these coins.
  - `feats(x, D, btcReg) → f` (the `Row.f` shape from Task 2), for a raw `SM.log` trade `x`, with `D[s] = {h1, m15, m5}` and `btcReg: t → string | null`:
    - `coin: x.s`, `side`, `type: x.type || 'rev'`, `tf`, `zone: x.zoneKind === 'FVG' ? 'FVG' : 'OB'`
    - `qBand` from `x.q.score`: `'<65' | '65–74' | '75+'`, or `'?'`
    - `grade: (x.grd && x.grd.g) || '?'`, `regime: x.regime || '?'`
    - `hour` from the UTC hour of `t0`: `'Asia'` [0,8), `'London'` [8,13), `'NY'` [13,21), `'late'` [21,24)
    - `wd: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][getUTCDay]`
    - `atr`: ATR(14) of the entry-tf bars closed by `t0` (`m15` for '15m', `h1` for '1h'), as a % of the last close
    - `mv: |tkAt(D[s].h1, floor(t0 / H) * H).pct|`, or null
    - `rrBand` from `x.rr`: `'<2.5' | '2.5–3.5' | '>3.5'`
    - `stopBand` from `|entry − stop0| / entry × 100`: `'<1%' | '1–2%' | '≥2%'`
    - `btc: btcReg(t0) || '?'`
    - `atrT` and `mvT` are filled later by `terciles`.
  - `ablPlan(st, exInfo) → {run: ABL[], skipped: [{k, lab, why}], snap: {cfg, adj}}`, in one `mkCore`:
    - Run `PREP` with `__ST` as in `simulate`, then `SB = JSON.parse(JSON.stringify(SB_DEF))`.
    - `eff = smWith(SB, () => JSON.stringify([smRules(), SM.cfg]))`.
    - For each `ABL` entry, compare `eff` before and after running its `sw`. Then restore by re-running `PREP` **and** `Object.assign(SB_OV, <copy taken before the first sw>)`, because `PREP` does not reset `SB_OV`. If nothing changed, the entry is skipped with `why: 'live value equals the switched value'`.
    - `snap = smWith(SB, () => ({cfg: SM.cfg, adj: RV.smAdj}))`, deep-copied, after `PREP`.
  - `yearRun(st, exInfo, {days, deadline}) → YearFile`. It does the following:
    1. Sets `END = floor(now / M5) * M5`, `W0 = END − days × 24 H`, `h0 = floor(W0 / H) * H`.
    2. For each `YEAR_COINS` coin it loads `h1` from `h0 − 96 H`, `m15` from `h0 − 100 × M15` and `m5` from `h0 − H`, all to `END`.
    3. Builds `U` with `yearHour` for every h from `h0` to `END`, and the steps as in `main`.
    4. Runs `base` (setup `''`) and `raw` (`RAW`) with `big = true`. Then it runs each `ablPlan().run` entry **only while `Date.now() < deadline`**; the rest are skipped with `why: 'out of time'`.
    5. Builds `btcReg` from one `mkCore`: `ctx.__B` = BTC's last 71 1h bars closed by t, then `X('(smRegime(__B) || {}).reg || null')`.
    6. Turns trades into rows with `Object.assign(row(x, v), {f: feats(x, D, btcReg)})`, then runs `terciles(rows, 'atr', 'atrT')` and `terciles(rows, 'mv', 'mvT')` per run.
    7. Returns `fitSize(YearFile)`.
  - `YearFile = {v: 1, sum: {t, from: W0, to: END, split: tSplit, days, coins: YEAR_COINS, runS, snap, base: {...sumRun, open}, raw: {...sumRun, open}, note, fundingNote}, abl, skipped, pat: findPatterns(rawRows), months: {base, raw}, exits: {base, raw}, trades}`:
    - `note = 'Backtest — report only, never changes live rules. SMC Big settings on BTC / ETH, one $1,000 account, 5m steps; same fills, fees and slippage as the 7-day backtest.'`
    - `fundingNote = 'Funding is not charged (no funding history in the backtest).'`
    - `trades` = the last 200 base rows plus the last 200 raw rows, by `t0`.
  - Standalone entry, local only: `STATE_IN=<state.json> BT_OUT=<out.json> [BT_YEAR_DAYS=3] node bot/backtest-year.mjs`. It exits 1 with `standalone runs are local only; the workflow runs the year mode via bot/backtest.mjs` when either env var is missing. `days = +process.env.BT_YEAR_DAYS || 365` and `deadline = Infinity`. It writes `JSON.stringify(file)` to `BT_OUT` and prints the base, raw and per-ablation one-liners.

- [ ] **Step 1: Write the failing test.** Create `tests/bt-year.mjs`. It needs no network: it reuses the `ex` + synthetic `H1` style of `tests/bt-universe.mjs`. The checks:

```js
import {yearHour, feats, ablPlan, RAW, ABL, YEAR_COINS} from '../bot/backtest-year.mjs';
import {mkCore, PREP} from '../bot/backtest.mjs';
// universe: BTC +40% on the day stays tradable, nothing tracked, only YEAR_COINS
const u = yearHour(H1, h, YEAR_COINS);
ok(u.big.join() === 'BTCUSDT,ETHUSDT' && Object.keys(u.trk).length === 0 && !('AAAUSDT' in u.tk), 'BTC +40%: still in the year universe, no tracker');
// feats under TZ=America/Creston: UTC hour bands + weekday
process.env.TZ = 'America/Creston';
const f13 = feats(tr(Date.UTC(2026, 10, 13, 13, 0)), D, () => 'up'), f1259 = feats(tr(Date.UTC(2026, 10, 13, 12, 59)), D, () => null);
ok(f13.hour === 'NY' && f1259.hour === 'London' && f13.wd === 'Fri' && f13.btc === 'up' && f1259.btc === '?', 'UTC hour band and weekday, btc regime');
ok(Math.abs(f13.atr - 1) < 0.05 && f13.zone === 'OB' && f13.stopBand === '1–2%' && f13.rrBand === '2.5–3.5' && f13.qBand === '65–74', 'ATR% and bands');
// ablation plan: rules in force -> all 10 run; empty state -> minQ and tp1R skipped, no throw
const P1 = await ablPlan({sm: {cfg: {}}, rv: {smAdj: {needHTF: true, minQ: 70, tp1R: 1.2}}}, ex);
ok(P1.run.length === 10 && !P1.skipped.length && P1.snap.cfg.minStopPct === 0.5 && P1.snap.cfg.invExit === 0, 'all 10 switches change the effective rules; snapshot = SB cfg');
const P0 = await ablPlan({}, ex);
ok(P0.skipped.map(s => s.k).sort().join() === 'minQ,tp1R', 'live = default -> minQ and tp1R listed as skipped');
// each switch hits its rule (as the SB account sees it), RAW clears the Reviewer rules but keeps the regime gate
const eff = async (setup) => { const {X, ctx} = await mkCore(null, ex); ctx.__ST = {cfg: {}, adj: {needHTF: true, minQ: 70}}; X(PREP); X('SB = JSON.parse(JSON.stringify(SB_DEF))'); X(setup); return JSON.parse(X('smWith(SB, () => JSON.stringify({r: smRules(), c: SM.cfg}))')); };
ok((await eff(sw('needHTF'))).r.needHTF === false && (await eff(sw('invExit'))).c.invExit === 1 && (await eff(sw('minStopPct'))).c.minStopPct === 1 && (await eff(sw('regimeGate'))).c.regimeGate === 0, 'switches land on SB');
const raw = await eff(RAW); ok(raw.r.needHTF === false && raw.r.minQ === 55 && raw.c.regimeGate === 1, 'raw run: Reviewer rules off, minQ 55, regime gate on');
```

The implementer writes the fixtures: `D` holds 15m bars with a constant range of 1% of the close; `tr(t0)` is a 15m OB long with `entry` 100, `stop0` 98.5, `rr` 3 and `q.score` 70; `sw(k)` is `ABL.find(a => a.k === k).sw`. The test ends with `PASS: year backtest checks`.
- [ ] **Step 2: Run it to verify it fails.** Run `node tests/bt-year.mjs`. Expected: fails with "Cannot find module … backtest-year.mjs".
- [ ] **Step 3: Implement** the `bot/backtest.mjs` exports, `PREP` and the `tkAt` change. Then write `bot/backtest-year.mjs` with the exports above, plus a header comment (spec path, report only, env vars).
- [ ] **Step 4: Run the tests to verify they pass.** Run `node tests/bt-year.mjs && node tests/bt-universe.mjs && node tests/year-report.mjs`. Expected: all three print PASS. `bt-universe` passing proves the `tkAt` change gives the same results.
- [ ] **Step 5: Local smoke run** (real Aster candles, a state file outside the repo). Run `STATE_IN=$TEMP/st.json BT_OUT=$TEMP/year3.json BT_YEAR_DAYS=3 node bot/backtest-year.mjs`. Expected: exit 0. The one-liners for base, raw and each ablation are printed. `node -e "const f=require(process.env.TEMP+'/year3.json');console.log(f.sum.base.all.n, f.abl.length+f.skipped.length, JSON.stringify(f).length)"` prints a trade count, `10`, and a size under 900000.
- [ ] **Step 6: Commit.** `git add bot/backtest.mjs bot/backtest-year.mjs tests/bt-year.mjs && git commit -m "Year backtest: BTC/ETH year run, raw run, rule ablation, entry features"`

---

### Task 4: Nightly wiring, runtime measurement, workflow timeout

**Files:**
- Modify: `bot/backtest.mjs`:
  - header env doc (lines 7–8)
  - `writeOut` local branch (line 34)
  - `main()` (after the SMC Big block, lines 216–224)
- Modify: `.github/workflows/smc-backtest.yml` (`timeout-minutes`, plus env `BT_DEADLINE_MIN`)

**Interfaces:**
- Consumes: Task 3 `yearRun(st, exInfo, {days, deadline})`, `YEAR_FILE`.
- Produces: branch `backtest` holds `smc-backtest.json`, `smc-backtest-big.json` and `smc-backtest-year.json` in one parentless commit. Env:
  - `BT_YEAR=0` skips the year mode.
  - `BT_YEAR_DAYS` (default 365).
  - `BT_DEADLINE_MIN` (default 35): minutes after process start, after which no new ablation run starts.
  - Local mode writes `<BT_OUT>`, `<BT_OUT>-big.json` and `<BT_OUT>-year.json`.

- [ ] **Step 1: Generalise `writeOut`'s local file names.** The local path becomes `LOCAL_OUT.replace(/(\.json)?$/, p.replace(/^smc-backtest|\.json$/g, '') + '.json')`: `smc-backtest.json` → `<BT_OUT>`, the big file → `<BT_OUT>-big.json`, and the year file → `<BT_OUT>-year.json`. Existing names stay as they are.
- [ ] **Step 2: Call the year mode in `main()`.** Do it after the big block, wrapped in `try/catch` like the big run (on failure, log `year backtest FAILED, writing the nightly reports only:` and carry on). Skip it when `process.env.BT_YEAR === '0'`. Load it with `const {yearRun, YEAR_FILE} = await import('./backtest-year.mjs')`, with `files[YEAR_FILE] = await yearRun(st, exInfo, {days: +process.env.BT_YEAR_DAYS || 365, deadline: T0 + (+(process.env.BT_DEADLINE_MIN ?? 35)) * 60e3})`. Print one line: `SMC year backtest <days>d · BTC/ETH · <s> s: base <f(base.all)> · raw <f(raw.all)> · <n> ablations (<m> skipped)`. The 7-day code above it stays unchanged.
- [ ] **Step 3: Verify the deadline guard and the file layout.** Run `STATE_IN=$TEMP/st.json BT_OUT=$TEMP/bt.json BT_DAYS=1 BT_YEAR_DAYS=1 BT_DEADLINE_MIN=0 node bot/backtest.mjs`. Expected:
  - exit 0;
  - `$TEMP/bt.json`, `$TEMP/bt-big.json` and `$TEMP/bt-year.json` all exist;
  - the year file has `abl.length === 0`, and every `ABL` key is in `skipped` (`out of time` or `live value equals…`);
  - `bt.json` keys = `v,sum,trades`. Its `sum` keys match a second run of the same command with `BT_YEAR=0` (diff the `Object.keys` of both `sum`s), and `bt-big.json` likewise.
- [ ] **Step 4: Measure the runtime.** Run `time (STATE_IN=$TEMP/st.json BT_OUT=$TEMP/y30.json BT_YEAR_DAYS=30 node bot/backtest-year.mjs)`. Record the kline-loading seconds and the per-run seconds from the log. Extrapolate to 365 days: loading × 12.2, runs × 12.2. If that is under 15 min, do one real 365-day run with the same command and `BT_YEAR_DAYS=365`, and record the wall time. Also time one `BT_YEAR=0 BT_DAYS=7 node bot/backtest.mjs` run (nightly only).
- [ ] **Step 5: Set the workflow timeout.**
  - `timeout-minutes` = ceil(1.5 × (nightly + year)), rounded up to a multiple of 5, minimum 45.
  - `BT_DEADLINE_MIN` = timeout − 10.
  - Put the measured numbers in a YAML comment.
  - **If the measured or extrapolated year run is over 30 min, stop and report to the main thread instead of splitting the job.** A separate job needs a merge-writer for the `backtest` branch, which is a design change.
- [ ] **Step 6: Commit.** `git add bot/backtest.mjs .github/workflows/smc-backtest.yml && git commit -m "Nightly backtest: add the BTC/ETH year mode (smc-backtest-year.json), deadline guard, timeout from measured runtime"`

---

### Task 5: Desk agent 7 "Backtester"

**Files:**
- Create: `src/bt_ui.js` (CRLF)
- Modify:
  - `build.py:13`: add `'bt_ui.js'` after `'sync.js'` in `order`; desk only, not `core`.
  - `src/engine.js:6-13`: `AGENTS` entry.
  - `src/scene.js:151`: `DESK_POS.bt`.
  - `src/ui.js`: `drawScreens` near :36; the `renderPanel` dispatch near :302.
  - `src/sync.js:250-255`: `BTS.year`, plus the third fetch in `btPull`.
  - `src/head.html:144,151,164`: `1`–`6` becomes `1`–`7`.
- Test: `tests/desk-smoke.mjs` (extend)
- Built: `index.html`, `bot/core.js`

**Interfaces:**
- Consumes: the Task 3 `YearFile` schema, `BTS`/`btPull`/`gh` from `src/sync.js`, and the house helpers `esc, fmtR, cls, fin, screenFrame, drawTable`.
- Produces:
  - The `AGENTS` entry `{id: 'bt', key: '7', name: 'Backtester', role: 'SMC Year Backtest · BTC / ETH', color: '#9ad0ff', blurb: 'Re-runs the SMC strategy over the past year on BTC and ETH every night: rule ablation and patterns. Report only, never changes live rules'}`.
  - `TABS.bt = [['sum', 'Summary & rules'], ['pat', 'Patterns'], ['tr', 'Trades']]`.
  - `btYearHTML(tab) → string` and `drawBtScreens(d)`.
  - `BTS.year`: the parsed file, or `null`.

- [ ] **Step 1: Write the failing test.** In `tests/desk-smoke.mjs`:
  - Add a fake `btYear` file. It has: two months, one held and one "did not hold" pattern, two `abl` rows (one `helpful`), one `skipped` entry, and 3 trades with `f`.
  - Route `/contents/smc-backtest-year.json` to it.
  - After the existing backtest checks, add:

```js
const by = await page.evaluate(async () => {
  const before = [localStorage.getItem('awx_sm'), localStorage.getItem('awx_sb'), JSON.stringify(RV.smAdj)];
  window.dispatchEvent(new KeyboardEvent('keydown', {key: '7'})); await new Promise(r => setTimeout(r, 1500)); renderPanel();
  const out = {open: PS.open, txt: {}};
  for (const t of ['sum', 'pat', 'tr']) { PS.tab.bt = t; setTabs(); renderPanel(); out.txt[t] = document.querySelector('#pbody').innerText; }
  const keep = BTS.year; BTS.year = null; PS.tab.bt = 'sum'; renderPanel(); out.empty = document.querySelector('#pbody').innerText; drawAllScreens(); BTS.year = keep;
  out.same = JSON.stringify(before) === JSON.stringify([localStorage.getItem('awx_sm'), localStorage.getItem('awx_sb'), JSON.stringify(RV.smAdj)]);
  return out; });
if (by.open !== 'bt') errs.push('PAGEERR key 7 does not open the Backtester');
if (!/Backtest — report only, never changes live rules/.test(by.txt.sum) || !/helpful/i.test(by.txt.sum) || !/skipped/i.test(by.txt.sum)) errs.push('PAGEERR Backtester summary/ablation missing');
if (!/raw run/i.test(by.txt.pat) || !/did not hold/i.test(by.txt.pat) || !/first 8 months/i.test(by.txt.pat)) errs.push('PAGEERR Backtester patterns missing run label or per-half numbers');
if (!/no year backtest has run yet|Connect Sync/i.test(by.empty)) errs.push('PAGEERR Backtester has no empty-state message');
if (!by.same) errs.push('PAGEERR Backtester changed live state');
```

- [ ] **Step 2: Run it to verify it fails.** Run `PYTHONUTF8=1 py -3 build.py && node tests/desk-smoke.mjs`. Expected: `FAIL` with `PAGEERR key 7 does not open the Backtester`.
- [ ] **Step 3: Implement.**
  - **`src/sync.js`.**
    - `BTS` gets `year: null`.
    - `btPull`'s `Promise.all` gets a third fetch, `smc-backtest-year.json` with `ok404: true`, which sets `BTS.year`.
    - The existing two files are handled unchanged.
  - **`src/bt_ui.js`.**
    - `TABS.bt` as above.
    - `btYearHTML(tab)` calls `btPull()` first. With no Sync set it shows `Connect Sync (Sync panel) to read the backtest results.`; with no file it shows `No year backtest has run yet.` (or `BTS.err`).
    - Every tab starts with the label `Backtest — report only, never changes live rules`, the window dates and `fundingNote`.
    - `sum`:
      - a table with the rows "Rules in force (base run)" and "Raw run (all Reviewer rules off)";
      - the columns n / avg R / win % / total R / max DD for the whole year, the first 8 months, the last 4 months, BTC and ETH;
      - the ablation table: rule | live vs switched n / avg R | Δ avg first 8 months | Δ avg last 4 months | Δ total R | label (helpful / harmful / no clear effect), in file order;
      - the "Skipped" list with its reasons;
      - the rule snapshot in a `<details>`.
    - `pat`:
      - the heading `From the raw run (all Reviewer rules off)`;
      - the "Held" and then "Did not hold" tables: `feature = value` | this side n / avg R for the first 8 months and the last 4 months | the rest, same columns;
      - monthly avg R as CSS bars (`div` widths), base and raw;
      - the exit-reason breakdown.
    - `tr`: the trades table (run, coin, side, UTC date, tf, type, zone, q, grade, regime, hour, R, exit).
    - Null numbers render as `—`.
    - `drawBtScreens(d)`:
      - monitor A uses `screenFrame` with the title `BACKTESTER · BTC/ETH 1Y` and shows the base and raw lines (n, avg R, win %, total R) and the count of held patterns;
      - monitor B shows monthly base avg R bars;
      - with no file, both monitors say `no year run yet`.
  - **`src/ui.js`.**
    - In `drawScreens`: `if (a.id === 'bt') { try { return drawBtScreens(d); } catch (_) { return; } }`.
    - In `renderPanel`: `else if (id === 'bt') h += btYearHTML(tab);`.
  - **`src/scene.js`.**
    - Set `DESK_POS.bt` to a free spot (suggested `[-10.4, -5.6]`).
    - The desk centre must be ≥ 4.5 m from every other desk, and must not stand between the V or B teleport spots and their walls.
    - It keeps the default facing.
  - **`src/engine.js`.** Add the `AGENTS` entry.
  - **`src/head.html`.** Change the `1`–`6` help text to `1`–`7`.
- [ ] **Step 4: Run the tests to verify they pass.** Run `PYTHONUTF8=1 py -3 build.py && node tests/desk-smoke.mjs && node tests/cloud-dry-run.mjs`. Expected:
  - `PASS: no page errors`, with `panels checked:` including `bt`;
  - the cloud dry run passes (the `AGENTS` change is harmless in `core.js`);
  - in `desk-smoke.png`, the new desk overlaps nothing; look at the screenshot.
- [ ] **Step 5: Commit.** `git add src/bt_ui.js src/engine.js src/scene.js src/ui.js src/sync.js src/head.html build.py tests/desk-smoke.mjs index.html bot/core.js && git commit -m "Desk: agent 7 Backtester (SMC year backtest, read-only)"`

---

### Task 6: Docs

**Files:**
- Modify: `CLAUDE.md`, `docs/smc-backtest.md`

**Interfaces:**
- Consumes: the names, env vars, files and measured runtime from Tasks 1–5.
- Produces: docs only.

- [ ] **Step 1: `docs/smc-backtest.md`.** Add a section `## Year mode (BTC / ETH, agent 7)` covering:
  - window and coins;
  - SMC Big settings and one account;
  - the base / raw / ablation runs, with the exact switch list and the skip reasons;
  - the features and bands;
  - the thresholds (pattern: n ≥ 20, 0.3R, check n ≥ 8, cap 10; ablation 0.2R, both halves) and the 8 + 4-month halves;
  - the output file and its schema keys;
  - `BT_YEAR`, `BT_YEAR_DAYS`, `BT_DEADLINE_MIN`, and the measured runtime and timeout from Task 4;
  - the local commands (`node bot/backtest-year.mjs` standalone, `tests/year-report.mjs`, `tests/bt-year.mjs`);
  - the limits (no funding, BTC/ETH only, regime gate ablation via `SM.cfg.regimeGate`).
- [ ] **Step 2: `CLAUDE.md`.** Update these parts:
  - "Things that run without a computer" item 3: the same job also writes `smc-backtest-year.json`.
  - Source map: add `bt_ui.js`, and in the `smc.js` row mention `SM.cfg.regimeGate`.
  - "The agents": add item 8, **Backtester (key 7)**, in 2–3 bullets: report only; base vs raw; read in the panel.
  - "Decisions": add Nov 14, year backtester option A, with the raw run for patterns (Fred).
  - "Open items": the first year report is still to be read with Fred, and no rule changes without his yes.

  Keep the existing style: short bullets, no tokens.
- [ ] **Step 3: Verify.** Run `git diff --stat` and check that only the two docs files changed. Run `grep -n "smc-backtest-year.json\|key 7\|regimeGate" CLAUDE.md docs/smc-backtest.md`; each term should appear.
- [ ] **Step 4: Commit.** `git add CLAUDE.md docs/smc-backtest.md && git commit -m "Docs: SMC year backtester (agent 7)"`

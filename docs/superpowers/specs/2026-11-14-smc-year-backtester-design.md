# SMC year backtester on BTC / ETH (design, Nov 14 2026)

## Why
Fred: "我想整多個 agent 做 backtester … 用我地而家既 strategy 去不斷 backtest 啲幣種, 例如 ETH, BTC 過去一年既表現."
Then: "用 SMC 果套淨係套落 ETH BTC. 我想用黎決定 rule, strategy, 或者會唔會有特別 pattern, 我想叫個 backtester 去搵呢啲 pattern 出黎."

Live samples are tiny (SMC Big has 2 trades; the Nov 14 invExit decision rested on 5 differing trades in a 7-day
backtest of one market regime). A year of BTC / ETH gives hundreds of setups across up, down and range markets.
The output is used by Fred to decide rules and strategy changes and to see patterns he may not have spotted.

## Decision (Fred, Nov 14): option A
Extend the existing nightly backtest with a one-year BTC / ETH mode, an automatic pattern finder and a per-rule
ablation, and show the results as a new desk agent (key 7, "Backtester").
Rejected: B (local tool, run on request: not continuous, no desk view, costs usage each time) and
C (A + a weekly claude.ai routine that writes up findings: costs usage, Fred cut usage on Nov 11).

## Goals
1. **Year run.** Re-run the SMC strategy (same code as the cloud, via `mkCore` / `smWith(SB, …)` as the big-cap
   backtest already does) over the last 365 days on **BTCUSDT and ETHUSDT only**, with the **SMC Big settings**
   (`SM.cfg` from the live state + `SB_OV`, current `RV.smAdj` minus the locked `zone`, `zoneLearn` 0), one fresh
   $1,000 account trading both coins (same 3-position and 10× caps as live). 5m steps, same fills, fees and
   slippage as the 7-day backtest. The window rolls forward each night.
2. **Rule ablation.** One extra run per rule with only that rule switched (off if on, on if off), all else equal:
   `needHTF`, `needPOI`, `needDepth`, `obQ`, `minQ` (live value vs the `SM_DEF` default), `invExit`,
   `minStopPct` (0.5 vs 1.0), `tp1R` (live vs default), `cont` (continuation setups), the regime gate `smRegime`
   if it has a switch. For each: n, avg R, win %, total R, max drawdown in R, and the same for each half (below).
   Rules that have no switch in cfg / smAdj today are skipped and listed as skipped — no new switches in live code
   just for the ablation unless trivial and default-preserving.
3. **Pattern finder.** Every simulated trade stores features at entry; the finder splits the base run's trades on
   each feature and reports the splits that matter:
   - Features: coin (BTC/ETH), side, setup type (rev/cont), tf (15m/1h), zone kind (FVG/OB), quality score band,
     grade (A+/A/B/REJ), HTF regime (up/down/range/fakeout), UTC hour band (Asia 0–8, London 8–13, NY 13–21,
     late 21–24), weekday, volatility (ATR% of the entry tf, terciles over the year), day move % at entry
     (terciles), planned R:R band, stop % band, BTC 1h trend at entry (for ETH trades and for BTC itself),
     exit reason (reported as a breakdown, not a split).
   - A split is **reported** only if both sides have n ≥ 20, avg R differs by ≥ 0.3R, and the same direction holds
     in **both halves**: discovery = first 8 months, check = last 4 months, each side n ≥ 8 in the check half.
     Report n / avg R per side per half.
   - Splits that pass discovery but fail the check are listed separately as "did not hold" (so Fred sees what was
     tried), capped at 10.
   - Also: avg R by calendar month (shows which market periods the strategy works in).
4. **Desk agent 7 "Backtester".** New agent with its own desk / screen and panel (key 7), read-only:
   - Summary: window, coins, base n / avg R / win % / total R / max DD, per half and per coin.
   - Rule ablation table (rule, base vs switched, per half), sorted by |Δ total R|.
   - Patterns that held, then "did not hold", each with n / avg R per side per half.
   - Monthly avg R bars.
   - Trade list (last 200) with the features.
   - Clear label: "Backtest — report only, never changes live rules".
5. **Not continuous in the sense of always running:** it runs once per night as part of (or right after) the
   existing `smc-backtest.yml` job, and can be dispatched by hand.

## Non-goals / anti-goals
- **Never changes live rules** (no apply button, no input to `smLearn`, `smZoneTune`, `RV.smAdj`, SM / SB cfg).
  Fred decides in chat; Claude applies approved changes the usual way.
- Not a parameter optimiser: no grid search over many values; the ablation is one switch per rule.
- Not the Trader (reversal / momentum) strategies, not small caps, not other coins (BTC / ETH only for now;
  keep the coin list a single constant so adding SOL later is a one-line change).
- No new dependencies. No change to the cloud trader's trading or its 5-min run.
- Never commit trade data to this public repo; results go to the private data repo's `backtest` branch.
- Anti-goal: presenting a pattern as real when it is one regime or a handful of trades — the n ≥ 20 and
  two-halves rules exist for that, and the panel must show per-half numbers next to every pattern.

## Constraints
- Data: Aster has BTCUSDT / ETHUSDT 5m, 15m and 1h klines back to at least 2025-11-01 (checked Nov 14);
  ~105k 5m bars per coin per year, 1500 per request.
- Runtime: the 7-day big-cap run takes ~4 s for 17 coins. Year × 2 coins × (1 base + ~10 ablation runs) must fit
  well inside the job's 45-min timeout together with the existing nightly backtest; raise the timeout or split into
  its own job if needed. Watch for per-step costs that grow with history length (array slices / copies of the
  full candle history each step) — the existing code was only ever run on 7 days.
- Results file must stay small enough for the desk to fetch (target < 1 MB; trim the trade list if needed).
- The existing nightly 7-day report and its files (`smc-backtest.json`, `smc-backtest-big.json`) must be unchanged.
- Runs in America/Creston (daily loss limit resets at Creston midnight), like the cloud.
- Build: edit `src/`, run `build.py`, commit source + built files.

## Decided by Fred
- SMC strategy only, BTC and ETH only, past year.
- Purpose: decide rules / strategy, find patterns automatically.
- Option A (nightly, desk agent, no usage cost).
- **Pattern finder runs on an extra "raw" run** (Fred, Nov 14): all Reviewer rules off (`RV.smAdj` emptied, `minQ` at
  the `SM_DEF` default, regime gate on as in the strategy itself), so setups today's rules would block become trades and
  quality / HTF / POI / depth patterns can be found. Headline numbers and the rule ablation use the rules-in-force base
  run. The panel labels which run each number comes from.

## Claude's calls (Fred can correct)
- SMC Big settings (`SB_OV`), since BTC / ETH are big caps.
- Report only; the two-halves (8 + 4 months) check and n ≥ 20 / ≥ 0.3R thresholds.
- One shared account for both coins (matches how SMC Big trades); per-coin numbers in the report.
- Output file `smc-backtest-year.json` on branch `backtest`, written in the same parentless commit as the nightly files
  (or its own commit flow if it moves to a separate job — then it must not wipe the other files).

- **Rule snapshot.** The base and ablation runs use the rules in force that night (cfg + `smAdj`), which move as the
  Reviewer re-learns. The report stores that snapshot (cfg + `smAdj`) so night-to-night changes can be explained.
  For `minQ` ablation lower both `cfg.minQ` and `smAdj.minQ` (`smRules().minQ` takes the max).
- **Regime gate.** It has no switch today (`smRegimeOk`, src/smc.js:633, also used in setup ranking :404/:421). Add
  `SM.cfg.regimeGate` (default 1 = today's behaviour), proven default-preserving by a test, so it can be ablated.
  Also ablate `poiRule` alongside `needPOI`. For `invExit` the switched value is 1, since `SB_OV` sets it to 0.
- **Ablation noise guard.** A rule is labelled helpful or harmful only if Δ avg R ≥ 0.2R and the same sign holds in both
  halves. Otherwise it is "no clear effect". The sort is by that label first, then |Δ total R|.
- **Funding and features.** The backtest has no funding data, so results leave funding out; the report says so in one
  line. Features that trades don't store (ATR %, BTC 1h trend, day move) are computed afterwards from the candles at `t0`.
- **Universe.** The year mode loads only BTC and ETH candles and builds its own hourly universe, so `smBigList`
  sees just those two.

## Left to the builder
- Whether the year run lives in `bot/backtest.mjs` (a mode) or a sibling script sharing its helpers.
- Kline caching between nights (not required).
- Panel layout details, the agent's desk position and screen design in `scene.js`, colour.
- Tests: a Node test for the pattern finder's thresholds and two-halves rule on synthetic trades; extend
  `desk-smoke.mjs` to open agent 7 with a fake results file.

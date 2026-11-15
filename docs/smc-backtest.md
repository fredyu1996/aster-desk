# SMC nightly backtest (Nov 13, 2026)

Spec: `docs/superpowers/specs/2026-11-13-smc-backtest-design.md`. Fred chose **report only**: the backtest never changes live rules, `smLearn`, `smZoneTune` or cfg. Fred approves a rule in chat; Claude then applies it the usual way (a migration or a cfg change).

## What runs
- `.github/workflows/smc-backtest.yml` runs daily at 11:23 UTC (and on manual dispatch), with its own concurrency group. It runs `node bot/backtest.mjs` with `DATA_TOKEN`.
- **Since Nov 14 the nightly job runs with `BT_WEEK '0'`: year mode only.** The 7-day small-cap and SMC Big reports below are **paused** (Fred). Their last `smc-backtest.json` / `smc-backtest-big.json` stay readable on branch `backtest`, because the writer carries over files it does not write. To turn them back on set `BT_WEEK '1'` in the workflow and re-size the timeout for week + year.
- (7-day mode, paused) It reads branch `state` (SM.cfg, RV.smAdj, the live SMC log). It writes `smc-backtest.json` to branch `backtest` of `aster-desk-data`, as one parentless commit that is force-updated. The file is about 20–60 KB.
- GitHub's own cron has been unreliable for this repo. If the daily run does not fire, dispatch it from cron-job.org the way the cloud trader is dispatched.

## How it simulates
- **Window and steps.** The window is the last `BT_DAYS` days (default 7). The script steps at each 5m close.
- **Tracker.** At every hour it is rebuilt from the 1h bars of every USDT perp that have closed by that hour. It uses the desk's own `recomputeUniverse` / `trkTop`: top 5 per side, volume ≥ `trkMinVol`, move ≥ `trkMinMove`. A coin stays tracked for 24 h after it was last in the top 5.
- **Strategy.** `smTick` runs in a Node vm on `bot/core.js`, with the live cfg and `RV.smAdj` (the locked zone weights removed). At step T it sees closed 15m and 1h bars, plus a forming bar built from the 5m bars closed by T. At a 15m or 1h boundary there is no forming bar, as in `tools/smc-replay.mjs`.
- **Fills and management.** Entries fill at the 5m close plus slippage. Positions are managed on the following 5m candles, worst extreme first, the same way the cloud replays candles.
- **Variants.**
  - `base`: the rules in force.
  - `zone`: the proposed `smAdj.zone` weights, unlocked.
  - `noObQ`: the `obQ` bar removed.
- **Parked decisions.** Each is split into kept vs dropped, in the backtest and on live trades:
  - taker flow against the trade (`cx.flow`, the 1h net taker flow from 15m kline taker-buy volume; this is the same reading behind the Nov 12 audit's −0.41R n12 figure);
  - a 24h move of 15–40% (`cx.mv`);
  - FVG vs OB;
  - OB q ≥ / < the `obQ` bar, plus the number of OB setups the bar blocked.
- **Sim vs live.** The script counts the live trades in the window that the backtest also entered (same coin and side, within ±30 min) and their mean |R| gap. For the rest it gives the backtest's read at the live entry time.

## Big-cap mode (paused)
- The same run also backtests the top 10 coins by 24 h volume with the SMC Big settings (`SB_OV`) and writes `smc-backtest-big.json` to branch `backtest`, in the same commit as `smc-backtest.json`.
- Reviewer → SMC review shows it as a second block, "BIG CAPS · BACKTEST (PROPOSAL ONLY)".

## Limits (7-day mode)
- Coins delisted since are missing.
- The tracker updates hourly (live: continuously).
- 24h volume and move come from 1h bars.
- Funding is not charged.
- Live trades taken under older rules naturally won't match.

## Local run (no GitHub)
```bash
STATE_IN=<state.json outside the repo> BT_OUT=<out.json> BT_DAYS=2 node bot/backtest.mjs
node tests/bt-universe.mjs   # look-ahead check: tracker and strategy view only use closed bars
```
- Never commit a state file or the output: they hold trade data.
- The desk shows the result in Reviewer → SMC review → "Backtest (proposal only, not applied)". It needs the Sync token.

## Year mode (BTC / ETH, agent 7)
Spec: `docs/superpowers/specs/2026-11-14-smc-year-backtester-design.md`. Report only, like the rest: it never changes live rules. Shown in the Backtester panel (key 7, `src/bt_ui.js`).
- **Window and coins.** The last `BT_YEAR_DAYS` days (default 365), 5m steps, BTCUSDT and ETHUSDT only. The first 8 months are the "pattern" half, the last 4 the "check" half. `needCoins` fails the run when BTC or ETH candles are missing, so a mislabelled report is never written.
- **Account.** SMC Big settings (`SB_OV`), one $1,000 account across both coins, same fills, fees and slippage as the 7-day backtest. Funding is not charged.
- **Runs.**
  - `base`: the rules in force.
  - `raw`: all Reviewer rules off (`RV.smAdj = {}`, `minQ` back to the default). The pattern finder reads this run.
  - 11 ablation runs, each flipping one switch off the live value: `needHTF`, `needPOI`, `needDepth`, `obQ`, `poiRule`, `minQ`, `tp1R`, `invExit`, `minStopPct`, `cont`, `regimeGate` (`SM.cfg.regimeGate`; live stays 1).
  - Skip reasons, listed in `skipped`: "live value equals the switched value" (the switch would change nothing tonight) and "out of time" (it would start after the deadline).
- **Features per trade** (entry-time, in `f`): coin, side, type, tf, zone (FVG / OB), qBand (<65, 65–74, 75+), grade, regime, hour (UTC: Asia / London / NY / late), wd, atrT and mvT (terciles low / mid / high), rrBand (<2.5, 2.5–3.5, >3.5), stopBand (<1%, 1–2%, ≥2%), btc (BTC 1h regime).
- **Thresholds.**
  - Pattern: n ≥ 20 on each side in the first 8 months and a gap ≥ 0.3R. It "held" if the last 4 months have n ≥ 8 on each side and the gap has the same sign; otherwise it is "not held" (top 10 shown).
  - Ablation: each row flips one live setting (a rule off, or a value back to its default; `invExit` turns on). The switched run must differ from base by ≥ 0.2R overall and in the same direction in both halves, else "no clear effect". "helpful" = the live (base) setting is better in both halves by ≥ 0.2R overall; "harmful" = the switch is better, i.e. the live setting hurts.
  - Check-half samples are small (often 8–20 trades): read patterns as leads, not rules.
- **Output.** `smc-backtest-year.json` on branch `backtest` (same commit as the other files), at most about 900 KB (oldest trades trimmed, `sum.trimmed`). Keys: `v`, `sum` (window, split, `snap` of the rules, `base` / `raw` stats with per-coin and per-half, open positions, notes), `abl`, `skipped`, `pat` (`held`, `notHeld`), `months`, `exits`, `trades` (last 200 of base and raw, with features).
- **Env.** `BT_WEEK` (default 1; 0 = skip the 7-day runs), `BT_YEAR` (0 skips the year run), `BT_YEAR_DAYS` (default 365), `BT_DEADLINE_MIN` (default 35; the workflow sets 31): minutes after start, after which no new ablation starts. The standalone `node bot/backtest-year.mjs` uses no deadline: all ablations run.
- **Runtime.** Measured locally on Nov 14: 365 days took 19 min 32 s (loading 32 s, base 84 s, raw 79 s, each ablation 75–225 s; all 11 ran). Workflow timeout 45 min; deadline 31 min = 45 − 10 − 4, where 4 min is the longest ablation.
- **Local run.**
```bash
STATE_IN=<state.json outside the repo> BT_OUT=<out.json> [BT_YEAR_DAYS=3] node bot/backtest-year.mjs   # year mode alone, real Aster candles
node tests/year-report.mjs   # statistics maths
node tests/bt-year.mjs       # year run pieces (switches, features, needCoins)
```
- **Limits.** No funding. BTC / ETH only, so patterns are not evidence for small caps. Check halves are small. The regime-gate ablation works through `SM.cfg.regimeGate` (0 = gate off).

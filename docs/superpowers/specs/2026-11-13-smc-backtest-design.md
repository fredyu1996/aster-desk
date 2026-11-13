# SMC Trader nightly backtest (design, Nov 13 2026)

## Why
Fred: "SMC Trader should backtest its own strategy on past data when it isn't trading, so it can learn."
The real blocker today is sample size: 38 live SMC trades, and three decisions are parked until ~20 more
(taker-flow filter, 15–40% day-move filter, the locked zone rule `zoneLearn`, OB vs FVG / `obQ` bar).
A backtest over the last days of tracked movers turns that into hundreds of setups.

## Decision (Fred, Nov 13): option A — report only
- Backtest results **never change live rules**. No auto-apply, no input to `smLearn` / `smZoneTune` live state.
- They are shown as proposals with backtest n / avg R next to live n / avg R. Fred approves in chat;
  Claude applies approved rules the usual way (migration / cfg).
- Rejected: B (auto-apply). Fill differences between sim and live plus overfitting (the zone rule changed
  4 times in its first hour) make self-modification unsafe.

## Goals
- Re-run the SMC Trader, with the **current** live cfg + `RV.smAdj` (minus locked `zone`), over the last
  `BT_DAYS` (default 7) days on the coins the tracker *would have* followed at the time.
- Record every simulated trade with the same fields the live log has (R, exitWhy, tf, type, zoneKind, q,
  grd, htfBias, …) plus the features the parked decisions need (day move at entry, taker flow vs side if
  derivable from kline taker-buy volume).
- Produce splits for each parked decision: kept vs dropped n / avg R in backtest, and the same split on live trades.
- Zone rule: also run a second variant with the current `smZoneTune` proposal applied, report both.
- Publish a small result file the desk shows in the Reviewer's SMC section, labelled "backtest — proposal only".

## Non-goals / anti-goals
- No live-rule changes, no apply button (Fred approves in chat).
- No new dependencies. No change to cloud-trader trading behaviour or its 5-min run.
- Never commit trade data to this public repo.
- Not a strategy optimiser / parameter sweep.
- Failure mode to avoid: numbers that look better than live because of look-ahead (coin picked by future
  move, candles from after the decision time). Sim must only see bars closed at the step time.

## Constraints
- Reuse the `tools/smc-replay.mjs` harness pattern (core.js in a Node vm; inject `S.kl`, `S.h1`, `S.tk`,
  `S.trk`; `CLOCK_OVR`; `smTick`; manage with `smManage` / `PX_OVR`, adverse extreme first; fees + slippage
  from cfg). Don't fork the strategy logic.
- Step at each 5m close (the cloud's own cadence).
- Universe: rebuild the tracker from 1h klines of all USDT perps: at each hour, rolling 24h % change and quote
  volume; top 5 gainers + top 5 losers with vol ≥ `minVol` and |move| ≥ 8% (current `trkTop` rules); a coin
  stays tracked 24 h from when it entered (as the day tracker does).
- Aster REST is public; pace requests (≤ ~10/s, retry on 429/5xx).
- Runs as its own GitHub workflow (`smc-backtest.yml`): daily schedule + `workflow_dispatch`, uses
  `DATA_TOKEN`. Does not share the cloud-trader concurrency group.
- Output goes to private repo `aster-desk-data`, branch `backtest`, file `smc-backtest.json`, single
  parentless commit force-updated (same pattern as `state`). Keep it small (summary + trimmed trade rows, < 300 KB).

## Left to the builder
Exact field names, how flow-vs-side is derived, file layout of the script, how the desk fetches the branch
(reuse `sync.js` helpers), exact panel layout.

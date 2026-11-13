# SMC nightly backtest (Nov 13, 2026)

Spec: `docs/superpowers/specs/2026-11-13-smc-backtest-design.md`. Fred chose **report only**: the backtest never changes live rules, `smLearn`, `smZoneTune` or cfg. Fred approves a rule in chat; Claude then applies it the usual way (a migration or a cfg change).

## What runs
- `.github/workflows/smc-backtest.yml` runs daily at 11:23 UTC (and on manual dispatch), with its own concurrency group. It runs `node bot/backtest.mjs` with `DATA_TOKEN`.
- It reads branch `state` (SM.cfg, RV.smAdj, the live SMC log). It writes `smc-backtest.json` to branch `backtest` of `aster-desk-data`, as one parentless commit that is force-updated. The file is about 20–60 KB.
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

## Limits
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

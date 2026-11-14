# Big-cap SMC Trader — design (Nov 13, 2026)

## Intent
Fred wants to know whether his SMC strategy works better on big caps than on the small-cap movers the
SMC Trader trades today. Build a second **paper** SMC account that runs the *same* strategy on the ten
highest-volume Aster perps, plus a big-cap mode for the nightly backtest so there is an early read the
same day. The comparison is in R, net of costs.

## Goals
- A second $1,000 paper account (`SB`, "SMC Big") traded by the cloud every 5 min, same lock rules as today. **On from the first deploy** (`SB.on = true`; Fred, Nov 13).
- Coin list: top 10 Aster perps by 24h quote volume among all Aster USDT perps in `S.meta` with a ticker, stock perps out unless `CFG.includeStocks` (their closed sessions distort sweeps and ATR — Claude's call). Not `eligible()`: its `smallCapOnly` default drops every Aster "Top" coin, i.e. exactly the big caps, **skipping coins in `S.trk`** (the small-cap tracker), recomputed every cycle. Coins with an open `SB` position keep being managed even after they leave the list.
- Same strategy code path (`smcRead` → `smTick` gates → `smManage`). Same Reviewer rules (`smRules()`, i.e. `RV.smAdj`), per Fred: "大幣規則跟細幣".
- Only the percent-based numbers tuned for small caps change, per account:

  | Setting | Small caps (`SM`) | Big caps (`SB`) |
  |---|---|---|
  | `minStopPct` | 1.5 | 0.5 |
  | stop buffer beyond the sweep (`smRules().stopBuf`, Reviewer has it at 0.6) | as is | × 0.25 (0.6 → 0.15) |
  | "stop too tight" floor (`r.dist < 0.006` in `smTick`) | 0.6% | 0.4% |
  | `slipPct` | 0.10 | 0.02 |
  | `minVol` | 300K | unchanged (moot for top 10) |

  The ×0.25 applies to every stop buffer `SB` uses: the Reviewer's value, the `cfg.stopBuf` fallback when the Reviewer has none, and the trailing buffer in `smManage` (`src/smc.js:592`, raw `SM.cfg.stopBuf`). (Claude's call.)

  `SB.cfg` stores **only these overrides**; every other setting is read live from `SM.cfg`, so panel changes and a future `zoneLearn` unlock reach both accounts. Account switches (`on`, `paused`, `day`, `cool`) are per account. (Claude's call, from "大幣規則跟細幣".)

  Leverage (Fred, Nov 13, option C): 10× is the account leverage / margin setting; size still comes from 1% risk, capped at 10× total (≤ 3.3× per position) — same as `SM` today. Not "every trade at 10× notional".

  Everything else (1% risk, max 3 positions, 10× total leverage cap, daily loss 3%, minRR 2, tp1R, holds, unlock guard, quality bars) is the same.
  The quality score (`smQuality`) is already ATR-relative, so it needs no scaling.
- Backtest: `bot/backtest.mjs` gets a big-cap mode that replays the same 7 days on the same top-10-by-volume list with the `SB` settings, and the workflow runs both modes. Report only, never changes rules.
- Desk: SMC panel gets a Small caps / Big caps switch (same panels, other account). Return race on the north wall gets a third line. Reviewer → SMC review shows the big-cap backtest block next to the existing one.

## Non-goals (v1)
- The Reviewer does **not** learn from `SB` trades; `SB` trades never feed `smLearn`, `rvRun`, coaching or the zone tuner.
- No review wall / "Your review" form / SMC south wall for `SB`.
- No separate rules, no market-cap data source (CoinGecko etc.).

## Anti-goals
- Any change to how the small-cap SMC Trader trades or learns. `SM` behaviour, settings and state must be byte-for-byte the same as before for the same inputs.
- Trade data in the public repo.

## Constraints
- Paper only. Built files (`index.html`, `bot/core.js`) committed with source.
- State file is already ~700 KB; `SB` adds a new top-level key `sb` (state branch + localStorage `awx_sb`). Keep `SB.log`/`eqs` trimmed the same way as `SM`.
- Cloud run must stay within the 6-min workflow timeout: 10 more coins of 15m/1h/4h klines.
- Big-cap coins need candles: they must be added wherever the desk/cloud decide which coins get klines (`h1set()`, `prio` in `recomputeUniverse()`, and the kline loading in `bot/run.mjs`).

## Approaches considered
1. **Live paper account only** — real forward test, but slow (~1–3 trades/day on 10 coins under the regime gate; ~2 weeks to 20 trades).
2. **Backtest only** — answer today with the existing tool, but sim vs live agreement was weak (7 of 38 live entries matched), so reference only.
3. **Both (picked by Fred)** — backtest gives an early read; the live account is the real test. Both run the same core, so the backtest mode is cheap once the account exists.

Implementation approach (builder's call, recommended): keep one strategy implementation and run it per account by swapping the `SM` global (and the coin set / per-account settings) around `smTick`, rather than copying `smc.js`. Whatever is chosen must leave every existing `SM` reader (`review.js`, `lessons.js`, `smc_ui.js`, `sync.js`, `bot/run.mjs`) seeing the small-cap account outside the swap.

## Also settled
- Backtest: top 10 recomputed every hour from rolling 24h volume, minus that hour's tracker coins (same way `trkHour` rebuilds the tracker).
- Known risk, accepted: a browser still running the pre-deploy desk that takes the lock (cloud silent 30+ min) saves state without `sb`, and the next cloud run starts `SB` fresh. The state file is the only copy, so the cloud can't keep it. Hard refresh after deploy.
- Big-cap coins must not enter `h1set()` or `S.prio`: `h1set()` feeds the Trader's momentum scan and `S.prio` caps aggTrade subscriptions at 40, so either would change the other agents. They get candles through their own additions at the kline job sites.

## Left to the builder
- How the per-account overrides (stop buffer multiplier, tight-stop floor) are expressed in `SB.cfg`.
- How `S.smC` (per-symbol read cache) avoids mixing the two accounts (the coin sets don't overlap by construction, but held positions might).
- UI details of the switch and the third race line.

## Verification
- `node tests/smc-sweep.mjs` and existing tests still pass; desk smoke test passes with the switch toggled.
- A test that `SM` decisions/state are unchanged when `SB` runs in the same cycle.
- A test that an `SB` setup with a 0.5–1.5% stop is taken (not skipped by the small-cap floors).
- Local cloud cycle (`STATE_IN=… node bot/run.mjs`) writes an `sb` block and a coin list of 10 that excludes `S.trk`.
- Backtest big-cap mode runs locally and produces a report.

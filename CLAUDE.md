# Aster Desk: handoff for Claude Code

Fred's walkable 3D trading workstation for small-cap perps on Aster DEX, with rule-based agents and two **paper** trading accounts. Built Nov 7–12, 2026 in claude.ai sessions; this file carries everything needed to keep going here. Detailed notes are in `docs/` (read the one that matches the task before changing that part).

## Working with Fred
- **Fred** lives in Vancouver (America/Vancouver). He is a trend-reversal trader focused on small caps.
- **Language.** He writes in Cantonese (sometimes English). Reply in colloquial Cantonese (Traditional Chinese). Keep code, identifiers and trading terms in English (FVG, OB, R, long/short).
- **What he wants back.** Short and concrete: what changed, what he'll see, and what's still open. No step-by-step narration. Lead with the answer; give numbers with their sample size.
- **Paper trading only.** Never place real orders and never hold his exchange keys. He must not paste private keys or tokens into chat.
- **Where tokens live.** Only in:
  - the `DATA_TOKEN` repo secret;
  - each browser's Sync panel (localStorage `awx_sync`);
  - the cron-job.org job header.
  - Never put a token in a commit, a doc or the chat. Fred creates tokens and accounts and sets secrets himself.
- **Course videos and PDFs** he sends: take the concepts only, never reproduce the material.
- **Evidence over enthusiasm.** He asked for honest audits. Say when a sample is too small, and don't add a rule the trades don't back. Ask before changing a strategy when the evidence is thin. On Nov 12 he chose "wait for more trades" before adding SMC flow / daily-move filters.

## Where everything lives
| What | Where |
|---|---|
| Source | `src/` (this repo). **Edit here only.** |
| Desk (built) | `index.html`, served by GitHub Pages: https://fredyu1996.github.io/aster-desk/ (users need a hard refresh after a deploy) |
| Cloud trader | `bot/run.mjs` + generated `bot/core.js`, run by `.github/workflows/cloud-trader.yml` |
| Unlock calendar | `unlocks.json` (root). The desk re-fetches it every 6 h; a snapshot is embedded at build time |
| Shared paper accounts | private repo `fredyu1996/aster-desk-data`, branch `state`, file `aster-desk-state.json`. Always a single parentless commit, force-updated. Holds `pt, rv, sm, trk, cfg, oi, cloud, lock` |
| SMC Big account | key `sb` in the same state file; browser copy in localStorage `awx_sb` |
| SMC BTC/ETH account | key `se` in the same state file; browser copy in localStorage `awx_se` |
| SMC Pattern (v1.4) account | key `sp` in the same state file; browser copy in localStorage `awx_sp` |
| Fred's own trade reviews | same private repo, branch `notes`: `manual-reviews.json` + `img/*.jpg` (normal commits; read → merge → write, retry on conflict) |
| Notes | `docs/`. The claude.ai project "Trading workstation" has the same docs; this repo is now the copy to keep current |

This repo is **public**: free Pages and Actions need that. It holds no data or keys, and the built `index.html` already contains all the code.

## Things that run without a computer
1. **Cloud trader.** An external timer at **cron-job.org** (Fred's account, job "Aster cloud trader") calls GitHub's `workflow_dispatch` every 5 min, because GitHub's own `*/5` cron never fired.
   - Its token is a fine-grained PAT "aster-desk timer" (`aster-desk` only, Actions read/write). **It expires.**
   - If runs stop, check that token first: cron-job.org's history shows 401/403.
   - Each run uses the `DATA_TOKEN` secret (`aster-desk-data` only, Contents read/write).
2. **`keepalive.yml`** makes a monthly commit so GitHub doesn't pause schedules.
3. **`smc-backtest.yml`** (daily 11:23 UTC + manual): `bot/backtest.mjs` now runs the **year mode only** (`BT_WEEK '0'`): SMC Big on BTC / ETH over 365 days, written as `smc-backtest-year.json` to branch `backtest` of the data repo. The 7-day small-cap and SMC Big reports are **paused** (Fred, Nov 14); their last files stay readable on the branch. Turn them back on with `BT_WEEK '1'` in the workflow, then re-size the timeout for week + year. **Report only**: never changes live rules; the year report is shown in the Backtester panel (key 7), the 7-day ones in Reviewer → SMC review. See `docs/smc-backtest.md`.
4. **Scheduled tasks on claude.ai** (Fred's account; not visible from Claude Code):
   - **"Aster cloud watchdog"**: hourly at :58. Reads the public Actions API; push notification on trouble.
   - **"Aster unlock calendar research"**: **stopped Nov 20 (Fred pauses it on claude.ai; unlock guard off, `nounl1120`).** Was daily 4:32 AM America/Creston.
     - Web-searches unlocks and updates the project doc.
     - **Clones this repo and pushes `unlocks.json` to a new branch `unlock-calendar/<date>-<time>`** (since Nov 16). The workflow `unlocks-publish.yml` checks the file (≥5 events, dates valid, not older than main, not less than half the events), commits it to main as "unlock calendar <date> (from unlock-calendar/…)" by github-actions[bot], and deletes the `unlock-calendar/*` branches.
     - Why a branch: a test on Nov 15 showed scheduled sessions **can create new branches but cannot delete them (HTTP 403)**, and their pushes to main did not land on Nov 12, 14 and 15.
     - Its message ends with "Desk repo updated via branch", "already up to date" or "DESK REPO NOT UPDATED: …".
     - So **`git pull` before you commit**; that commit lands every morning.
     - **History:** Nov 12, 14, 15 pushes to main did not land; Claude published those calendars by hand. Nov 13 landed (GitHub tool fallback). Nov 16–19: no branch pushed at all; the Nov 19 run failed with "usage limit reached" (the task's runs use Fred's plan usage).
   - **"Aster reversal watch"** (hourly dashboard): **paused** on Fred's request to cut usage. Its script is in `tools/reversal-watch.py`.
5. **The desk itself** shows "CLOUD QUIET · Xm" when the cloud has been silent for 20+ min. A connected browser takes over trading after 30 min of silence while it stays open.

## Build, test, deploy
```bash
npm install                      # once: three.js 0.149.0 (+ playwright for the smoke test)
python3 build.py                 # src/ → index.html + bot/core.js
node tests/smc-sweep.mjs         # SMC Trader logic in a Node vm: refuses a 15m short against a rising 1h, takes it when the 1h falls
node tests/pmr-golden.mjs        # GMS PMR v1.4 research module (bot/pmr.mjs): 30 golden / state-machine tests, no network
npx playwright install chromium  # once
node tests/desk-smoke.mjs        # opens the desk against a fake Aster API, opens every panel/tab, fails on page errors
# cloud cycle against a local file instead of the data repo (real Aster prices, no token needed):
echo '{}' > /tmp/st.json && STATE_IN=/tmp/st.json STATE_OUT=/tmp/st_out.json node bot/run.mjs
git pull --rebase && git add -A && git commit -m "…" && git push   # Pages + the next cloud run pick it up
```
- Always commit **both** the source and the built `index.html` / `bot/core.js`: Pages serves the built file and the cloud runs the built core.
- Don't hand-edit the built files.
- The cloud runs in America/Creston (UTC−7, no DST), so the daily loss limit resets at local midnight.
- Aster REST: `https://fapi.asterdex.com` (Binance-style; send requests with `referrerPolicy: 'no-referrer'` from browsers). Stream: `wss://fstream.asterdex.com/stream`. See `docs/data-notes.md` for what the API does and doesn't publish.

## Source map (`src/`, in build order)
| File | What |
|---|---|
| `head.html` | page shell, CSS, help overlay; build inlines three.js and the app |
| `engine.js` | data layer: markets, tickers, funding, OI snapshots, klines, alerts, `CFG` settings (`LS` = localStorage wrapper, keys `awx_*`), `trkTop()` (which movers get tracked) |
| `track.js` | day tracker (top movers for 24 h), 8-sign reversal read, momentum read, pattern tags |
| `unlock.js` | token-unlock calendar and guard (`unlocks.json` embedded at `/*UNLOCKS_JSON*/`) |
| `trader.js` | **Trader** paper account `PT` (reversal + momentum strategies), `ptTick`, `ptManage` |
| `smc.js` | **SMC Trader** paper account `SM` (and `SB`, SMC Big: `SB_OV` overrides, `smWith(SB, fn)` swaps the global `SM` around `fn`; `SE`, SMC BTC/ETH: `SE_COINS`, same `SB_OV`, `smWith(SE, fn)`, `smKey()` = 'sm' / 'sb' / 'se'): `smcRead/smcReadTf/smSetup/smContSetup/smQuality/smTick/smManage`, HTF zones, POI, path, draw, PD high/low, `SM.cfg.regimeGate` (1 live; 0 only for the year backtest's ablation) |
| `scene.js` | three.js room, desks, wall screens (`SWALL` south wall = SMC Trader positions, `RACE` north wall = return race of the three SMC accounts, `WALL` east wall = SMC Big + SMC BTC/ETH positions) |
| `ui.js` | panels (`TABS`, `openPanel`, `renderPanel`), keys (1 / 5 / 6 / 7 agents, C coin check, V review wall, B SMC wall, T toggles ✓/✗ tags at the wall, E review it yourself) |
| `check.js` | coin check (key C) |
| `trader_ui.js` | SMC Big + SMC BTC/ETH position wall (east wall): `drawWall` draws two sections via `drawAcctPos` inside `smWith(SB / SE, …)`; also `drawEq`, `drawPosChart`, `wrapText` (shared with the SMC wall). The Trader's wall until Nov 20; its panel and desk were removed Nov 20 |
| `review.js` | **Reviewer** `RV`: grading, `rvRun/rvAnalyze/rvSticky`, Fred's reviews (`youRead/youReadM/youTally/planPoints`), SMC study/learning/coaching (`smStudy/smLearn/smCoach/smAudit`), 24 h follow-ups, screening criteria and memos. Everything above the marker `/* ================= REVIEWER: screens + panel` also goes into `bot/core.js` |
| `smc_ui.js` | SMC panels, SMC wall, return race (SMC Trader, SMC Big, SMC BTC/ETH; no Trader since Nov 20) |
| `bt_ui.js` | **Backtester** panel (key 7): read-only view of `smc-backtest-year.json` (base vs raw, ablation, patterns, months) |
| `lessons.js` | trade charts (`drawTradeChart`; since Nov 16 zoom / pan / timeframes 5m–1d via `RVV` + `rvBars`, crosshair), `rvExplain` ✓/✗ items, review wall, "Your review" form, chart pictures, **"Mark my own setup"** (`rvPlanSim`, `drawPlan`), `rulesNow` |
| `sync.js` | GitHub sync (`state` and `notes` branches), roles/lock, chart-picture storage (IndexedDB + `img/` on notes) |

## The agents (desk keys)
Since Nov 20 (option A) keys 2, 3 and 4 are gone: OpenInterest, Flow and the Trader have no desk or panel. Their data feeds (OI snapshots, klines with taker volume, funding) still run for the SMC context, the tracker and the Reviewer, and their OI / flow / funding alerts still reach the alert feed (`FEED_AGENTS` in `engine.js` labels them). The whale (aggTrade) and liquidation (forceOrder) streams were removed.
1. **GainerLoser**: day tracker, watchlist, settings (Unlock calendar tab removed Nov 20) (the Top gainers / Top losers board tabs were removed Nov 20; `S.gainers` / `S.losers` still drive the tracker, SMC Big's coin list and the desk monitors).
2. ~~**OpenInterest**~~ (panel removed Nov 20): OI spikes and regime.
3. ~~**Flow**~~ (panel removed Nov 20): taker flow, funding.
4. **Trader** ($1,000 paper; panel removed Nov 20, stopped since `stop1119`, the engine still manages its open positions and hosts the SMC ticks in `ptTick`; since Nov 20 its open positions are on no wall and it is off the return race):
   - Reversal: shorts gainers at "Reversal forming / Reversed" with ≥5/8 signs. Reversal longs are **off** (Fred, Nov 8).
   - Momentum: both sides at ≥6/8. **Since Nov 15 momentum longs are off** (`momLong 0`): momentum shorts on losers only.
   - **Fade** (Nov 15, `fadeG 1`, `strat: 'fade'`, `ptFadeCand`): a gainer with a strong momentum read (≥ `momMinScore`) that rose ≥ `fadeMin1h` 2.5% in the last hour is SHORTED. Fixed rules as tested: stop = the momentum long's distance mirrored above (2–15%), target +2R, no half off, 6 h, 0.75% risk, max 2. The Reviewer does not learn from fade trades (fixed rules).
   - Risk: 1% per trade, max 3 positions, half off at +1.5R, target +3R, fade exits after 30 min, 12 h time stop, unlock guard, uses the Reviewer's screens. **No daily loss stop since Nov 16** (`dailyLossPct 0` = off, all three accounts).
5. **Reviewer**:
   - Grades trades A–F and reviews the Trader every 3 trades. Rules are learned from the last 40 trades **per strategy**, and stay until newer trades say the opposite (5-day re-test).
   - Reviews the SMC Trader on SMC terms (setup quality 0–100, HTF agreement) and coaches it (zones / liquidity / execution grades).
   - Does a 24 h follow-up after every trade and runs the screening-criteria study.
   - Reads Fred's reviews.
6. **SMC Trader** ($1,000 paper, own judgement: screens off):
   - Setup: a liquidity sweep → structure shift → FVG (else OB) pullback on 15m (1h filter) or 1h (4h filter), plus continuation setups.
   - Never against its higher timeframe.
   - Since Nov 11:
     - no entry in the outer 15% of the zone;
     - stop never closer than 1.5%;
     - exit if a candle closes through the entry gap before the half is taken;
     - draw on liquidity not scored on continuation setups.
   - Since Nov 15: GMS B + D (`gmsB`/`gmsD` 1, migration `gmsBD1115`): a clean sweep and closed-bar shift with a displacement candle, and only displacement FVGs as the entry zone. SMC Big keeps both 0 (`SB_OV`).
7. **SMC Big** ($1,000 paper, account `SB`, on from the first deploy):
   - Same strategy and same Reviewer rules (`smRules` / `RV.smAdj`) as the SMC Trader, on the **top 10 Aster perps by 24 h quote volume** (stock perps out unless `CFG.includeStocks`; coins in the small-cap tracker skipped). Recomputed every cycle; held coins keep being managed.
   - `SB.cfg` = live copy of `SM.cfg` + `SB_OV` (min stop 0.5%, slippage 0.02%, stop buffer ×0.25, tight 0.4%, screens off, `invExit` 0 = no exit when a candle closes through the entry gap). Sizing as above.
   - The Reviewer never learns from SB. Fred can review SB trades (review wall, "On the chart" SMC Big filter, Review chip on the Big caps trade log); they are keyed `sb|SYM|t1` and every learner skips them (`rvmLearn`). No south wall for it.
   - Desk: SMC panel (key 6) has a Small caps / Big caps switch with its own on/off toggle; the return race wall has its card, line and SMC BIG stats column; the east wall's left half shows its open positions.
   - The 7-day backtest also writes `smc-backtest-big.json` (report only; paused since Nov 14, last file stays readable).
   - A browser on the pre-deploy desk that takes the lock saves state without `sb`, and SB restarts fresh: hard refresh after a deploy.
8. **SMC BTC/ETH** ($1,000 paper, account `SE`, on from the first deploy, Nov 19):
   - SMC Big's settings exactly (`SE.cfg` = `SM.cfg` + `SB_OV`, no override table of its own), the settings of the 365-day year backtest, on **`SE_COINS` = BTCUSDT + ETHUSDT only** (one constant in `src/smc.js`; narrow it to one coin there). Held coins keep being managed.
   - Independent of SMC Big, which keeps trading its own top-10 list (BTC / ETH included). Ticks after SB in `ptTick`, each in its own try/catch; own per-coin read cache `S.smCE`; alerts start "SMC BTC/ETH PAPER".
   - The Reviewer never learns from SE (same as SB): trades keyed `se|SYM|t1`, skipped by `rvmLearn`; reviewable (review wall, "On the chart" SMC BTC/ETH filter, Review chip on its trade log).
   - Desk: SMC panel (key 6) switch Small caps / Big caps / BTC/ETH (read-only tabs + own on/off toggle); race wall has its card, line and BTC/ETH stats column; the east wall's right half shows its open positions. Cloud summary: `cloud.seEq` / `seOpen`.
   - Same pre-deploy caveat as SB: an old desk that takes the lock saves state without `se`, and SE restarts fresh.
   - Test: `tests/smc-btceth.mjs` (in `npm test`).
9. **Backtester** (key 7, report only):
   - Nightly year backtest of the SMC Big strategy on BTC / ETH (`smc-backtest-year.json`): never changes live rules, never touches the shared accounts.
   - Base = rules in force; raw = all Reviewer rules off (patterns come from raw); one ablation run per rule switch.
   - Read it in the panel (needs the Sync token). Details: `docs/smc-backtest.md`.
- Both traders: **10× total leverage cap** (Fred, Nov 11); per-trade size is still set by 1% risk.
- The tracker follows the top 5 gainers and losers **among coins with ≥ $300K volume that moved ≥ 8%** (GainerLoser → Settings).

## Fred's reviews → the Reviewer
- **Where he reviews.** Review wall (key V, then E) or Reviewer → "On the chart". The form has:
  - grade, agree / disagree, which ✓/✗ points he disputes;
  - "what I'd have done" chips;
  - comment;
  - up to 4 chart pictures with captions (shrunk to JPEG; pasted or uploaded);
  - "leave this trade out";
  - **✏️ Mark my own setup**: side, entry, stop, target, zones, lines, labels, stored as prices and times in `plan`. Since Nov 16 also real SMC objects: OB (click = that candle's full range, extended until a close through it; drag = custom box), FVG (click = the 3-candle gap), zone, HH/HL/LH/LL swing points (snap to the high/low within ±2 bars, drawn as a zigzag), BOS/MSS lines. Stored as `zones[].kind/dir`, `pts[{t,p,k}]`, `brk[{t0,t1,p,k}]`; prices and times, so they stay put on every timeframe.
- **How a review is read** (`youReadM`):
  1. If Claude has read the review (`rd`, below) and the text is unchanged, that reading is used.
  2. Otherwise the phrase reader `youRead(text, side)` runs over the comment + captions (English + Cantonese, side-aware: "should have been a short" on a long → `flip`).
  3. Points from the chart plan are added (`planPoints`: other side → flip; entry ≥0.25R deeper → later + depth; stop ≥0.2R out/in → wider/tighter; target ≥30% short / 40% past → exitE/hold). Since Nov 16 `drawPoints` also reads the drawings: last 3 swing points before the entry against the trade (LH/LL on a long) → `b: htf`, with it → `d: smc_htf`; MSS drawn against the side → `b: htf`; his same-side OB/FVG on the bot's zone → `d: smc_gap/smc_ob`, elsewhere → `b: gap/ob` + `a: later` (+depth) or `earlier`; an opposite box between entry and target → `b: room`.
- **Weights and thresholds.** A point counts at 2 and ≥ ⅓ of his reviews that say anything, or at 3 regardless (comment or plan = 1, ticked chip only = ½). SMC rules from it:
  - flip → `needHTF`
  - later / depth → `needDepth`
  - skip / poor gap / weak sweep → `minQ` +10
  - weak OB → `obQ` (order-block entries need the general quality bar + 10, max 90). **Not `fvgOnly`** (Fred, Nov 13: "poor OB" means that OB's quality, not "no OBs"). `fvgOnly` now only comes from trade data.
  - not at a POI → `needPOI`
- **Timing.** Cloud runs read the notes every cycle, so SMC rules update within ~5 min. A new or changed `rd` alone also triggers a re-learn (since Nov 13; before that it waited for new trade data). The Trader re-reviews after 2 new Trader reviews (or every 3 closed trades).
- **When Fred says "讀吓我啲 review" (read my reviews).** Read `manual-reviews.json` (and `img/*.jpg`) from the `notes` branch. For each review with text, write
  ```
  rd: {a: [...], b: [...], d: [...], txt: "1–2 sentences", n: <length of mineText(review)>, t: <ms>, by: "Claude"}
  ```
  then commit to `notes`. `mineText` = the comment plus the picture captions, joined with ". ". Keys:
  - `a` (what he'd have done): same, flip, skip, later, earlier, exitE, hold, wider, tighter, bigger, smaller
  - `b` (poor part): draw, cont, poi, room, htf, ob, gap, sweep, depth
  - `d` (fine / holds a rule): smc_gap, smc_ob, smc_htf, smc_poi, smc_path, smc_draw, tight, quickstop, forming
  - Done for 11 reviews on Nov 12 and 13 more on Nov 13 (24 of 32; 8 have no text). Tally over 24: other side 7, skip 8, against the HTF 6, enter later / deeper 4, poor OB 4, poor FVG 3, wider stop 3.
  - "Poor OB" only (AGT ×2, ONE) is read as `a: skip` + `b: ob` (Fred, Nov 13).
  - Bot read the 1h as bull on longs Fred calls a 1h downtrend (PREDICT, IDOL, ONE).

## State on Nov 19, 2026 (23:50 UTC, cloud run ~2,874; read from the `state` branch)
| | Equity | Trades | Wins | Avg R |
|---|---|---|---|---|
| Trader | $838 (3 open) | 322 | 127 | −0.08 |
| · reversal | | 137 | 64 | +0.01 |
| · momentum | | 166 | 53 | −0.17 |
| · fade (since Nov 15 22:39 Vancouver) | | 18 | 10 | +0.11 (+1.9R) |
| SMC Trader | $940 | 51 | 18 | −0.12 |
| · since GMS B+D (resumed Nov 15) | | 8 | 2 | −0.05 (−0.4R) |
| SMC Big | $939 | 16 | 6 | −0.39 |
| · since resume Nov 15 (GMS C) | | 13 | 6 | −0.27 (−3.5R) |

Since the fade went live, the Trader's reversal shorts did −0.06R n48 (−2.9R) and its momentum shorts −0.21R n20 (−4.1R). All samples are small.

- **SMC rules in force (Reviewer `RV.smAdj`):**
  - HTF must agree (`needHTF`);
  - midpoint / deeper entries (`needDepth`);
  - only from an HTF zone or swing (`needPOI`);
  - quality ≥ 70; order blocks ≥ 80 (`obQ`);
  - half at +1.2R;
  - stop 0.6% beyond the sweep.
  - Zone weights are proposed but locked (`zoneLearn 0`).
- **SMC live switches:**
  - SMC Trader: `gmsB 1`, `gmsD 1`, `gmsA/C 0`, `obPick 0`, `regimeGate 1`, `dailyLossPct 0`.
  - SMC Big: `SB_OV` `gmsC 1`, `gmsB/D 0`.
- **Trader cfg:** `momLong 0`, `fadeG 1`, `fadeMin1h 2.5`, `dailyLossPct 0`.
- **Trader Reviewer rules (`RV.active`):** target +2R, momentum size ×0.75, prefer "Fresh breakout", nothing avoided.
- **Fred's reviews:** 35 on `notes` (33 SMC Trader, 2 SMC Big); 24 have Claude's `rd`; 9 have a chart plan.
  - 3 reviews have text + a plan but no `rd` yet: BULLA (sm), ASTER (sb), BNB (sb).

## Decisions (Fred)
- **Nov 8:** reversal longs off; SMC Trader on its own judgement (no screens).
- **Nov 9:** the Reviewer weighs his written comments first.
- **Nov 11:**
  - 10× leverage cap;
  - after the audit "do everything except 1": momentum stays on as is;
  - hourly reports off, except the watchdog (watchdog stays on).
- **Nov 12:** wait for ~20 more SMC trades before deciding on:
  - a taker-flow filter (flow against the trade: −0.41R over 12 vs +0.08R over 18);
  - a filter for coins up or down 15–40% on the day (−0.95R over 8).
- **Nov 12–13 (SMC self-review):**
  - SMC Trader paused (`pause1113` migration sets `SM.on=false`). Fred resumes it by hand.
  - HTF regime gate `smRegime` (up = long only, down = short only, range = fade the outer 30%, fakeout = the opposite side, null = no trade).
  - Option B ("enter 30–60% into the zone, stop ≥ 2%") was tested in replay and **not adopted**: −1.05R over 4 trades.
  - Zone pick now scores every FVG/OB (`smZones` / `smZoneScore`); the default weights keep the old pick.
  - The Reviewer labels zones (right = touched, then ≥ 1R before a close through the far edge) and tunes the weights, but **`SM.cfg.zoneLearn=0` locks them**. Fred reviews the proposed rule in the Reviewer panel before unlocking.
  - From Fred's course PDF (concepts only):
    - OB = the full candle range;
    - setup grade A+/A/B/REJ with reason codes (informational, never gates);
    - PDF gates are tuner features, not hard gates.
  - 5m MSS/entry: not done.
  - Specs and plans: `docs/superpowers/`. Replays: `tools/smc-self-review.mjs`, `tools/smc-replay.mjs` (they need a state.json; never commit trade data).
- **Nov 13 (reviews):** his "poor OB" comments raise the OB quality bar (`obQ`), not FVG-only. The FVG-only rule from his comments was released (commits 943f208, a424293).
- **Nov 14 (SMC Big exits):** SMC Big only holds through a failed entry gap (`SB_OV.invExit = 0`). 7-day backtest: hold +0.75R n15 vs exit +0.48R n16, but only 5 trades differ (3 better, 2 worse, incl. the live XRP short). Small caps keep the exit: hold made 7 of 9 differing trades worse (net +0.87R from 2 big winners). Re-check after ~20 live SMC Big trades. Wider SMC Big min stop (1.0% / 1.5%) was tested and not adopted: fewer trades, less total R.
- **Nov 13 (SMC Big):** Fred wants to see if the SMC strategy works better on big caps. Top 10 by volume, `SB_OV` for big-cap sizes, rules follow the small-cap SMC Trader, on at deploy. Leverage option C: 10× is the margin setting, not 10× notional per trade; sizing stays 1% risk with the 10× total cap.
- **Nov 15 (GMS C on SMC Big):** Fred: "試住C先". `SB_OV.gmsC = 1` (GMS supply/demand zones for the POI and room check, SMC Big only; SMC Trader stays 0). Nightly year backtest has a `gmsC` ablation to keep tracking it. Re-check after ~20 live SMC Big trades.
- **Nov 15 (GMS B+D on the SMC Trader):** Fred: "開". `SM.cfg.gmsB = 1`, `gmsD = 1` (migration `gmsBD1115`), SMC Big unchanged (`SB_OV.gmsB/gmsD = 0`, `gmsC = 1`). Evidence: 21 d backtest +0.3R n26 vs −9.9R n56 (both halves better) + the zone study. Re-check after ~20 live SMC Trader trades. `tests/smc-sweep.mjs` turns B/D off (its synthetic leg has no displacement).
- **Nov 15 (pause + reverse review):** Fred: stop trading, have the Reviewer check whether the losing trades would have won reversed, have the Backtester note and test it. All three accounts paused (`pause1115`), then at 22:00 Vancouver Fred: "only the Trader stops": SMC Trader and SMC Big resumed (`resume1115`, `SM.cfg` / `SB.resume1115`). The Trader resumed at 22:39 with the new fade strategy (below). Results are in the Backtester panel (key 7) → **Strategy notes** (`BT_NOTES` in `src/bt_ui.js`; aggregates only, add new studies there). Tools: `tools/reverse-study.mjs` (replay every trade and its reverse on 5m candles, live state or `GT_FULL=1` backtest rows), `tools/mom-fade-test.mjs` (Trader momentum read rebuilt from candles: momentum vs fade).
  - Reversing everything is not a strategy (Trader −0.01R n235, SMC −0.20R n45, SMC backtests −0.18 to −0.58R). Losers-only looks good only in hindsight.
  - Timing study (Fred's idea, 30 d `MF_DAYS=30`): the trigger that holds is the last-hour move. Fade a strong-momentum gainer that rose ≥ 2.5% in the last hour: backtest +0.20R n103 (halves +0.20 / +0.20), live reversed +0.49R n33; under 2.5% ≈ 0. Hours in the tracker does not hold in the backtest; early momentum longs also lose (0–2 h −0.39R n37).
  - The one that holds: fading the Trader's momentum LONGS on strong gainers. Live 65: reversed +0.27R (halves 0.00 / +0.53). Backtest 21 d small caps, score ≥ 6: momentum long −0.24R n108, fade +0.14R n108 (halves +0.14 / +0.16). Momentum shorts on losers: flat, fading them loses. Not adopted yet; Fred decides.
- **Nov 15 22:39 (Trader: new strategy):** Fred "試新策略". Migration `fade1115`: `momLong = 0`, `fadeG = 1`, Trader trading again (`PT.on`). Evidence in the decision above and Backtester → Strategy notes. Review after ~20 fade trades (compare with the backtest +0.20R and live-reversed +0.49R).
- **Nov 16 (review chart):** Fred asked for TradingView-style charts, real SMC drawings, and a Reviewer that understands his reviews like Claude does.
  - (1) Zoom, pan and 5m–1d timeframes, and (2) OB / FVG / swing / BOS-MSS drawing tools plus `drawPoints` reading: done (commit c97a513; see "Fred's reviews").
  - (3) Claude-level reading of comments and pictures **waits for his choice**:
    - A: a claude.ai scheduled task runs "read my reviews" daily. It uses his plan's usage (the unlock task already hit the usage limit on Nov 19), and writing to `notes` from a cloud session is untested.
    - B: the cloud bot calls the Anthropic API with a key Fred creates and stores as a repo secret himself. Reviews read within ~5 min; costs API fees.
  - Until he picks, run the `read-my-reviews` skill when he asks.
- **Nov 16 (no daily loss stop):** Fred: the Trader and the SMC traders keep trading even after a day's loss passes 3%. Migration `nolimit1116`: `PT.cfg` / `SM.cfg.dailyLossPct = 0` (SMC Big inherits), today's pause cleared (the Trader had stopped at −3.2% on Nov 16). `dailyLossPct > 0` turns a limit back on.
- **Nov 19 (Fibonacci confluence, SMC Trader only):** Fred "試下 small caps 先". Migration `fib1119`: `SM.cfg.fib = 1` (the entry zone must lie on, or within 0.1 ATR of, the 0.5 / 0.618 / 0.79 retracement of the setup leg, or the setup is skipped); `SB_OV.fib = 0` keeps SMC Big off. Every trade records `zone.fibHit` whatever the switch. Switch and level math: comment above `SM_FIB` in `src/smc.js`; test tool `tools/smc-fib-test.mjs` (variants base, fib0–3, each also setting `SB_OV.fib`).
  - Backtest Nov 19 (window ending 2026-11-20 00:20 UTC), total R: small caps 21 d base +5.3R n27 · fib1 +6.8R n24 (half 1 equal, half 2 +0.2 vs −1.3; it only drops the 3 no-level trades) · fib2 (0.618–0.79 only) +1.4R n20 · fib3 (pick preference) +4.3R n27. Big caps 21 d base +5.2R n44 · fib1 +7.5R n35 (half 1 worse) · fib2 +6.9R n30 · fib3 +0.2R n51. BTC/ETH 365 d base +24.2R n89 · fib1 +14.7R n58 · fib2 +6.6R n40 · fib3 +7.2R n88; there the no-level trades did better (+0.34R n32).
  - By level (base trades, avg R): small 0.5 +0.46 n21 · 0.618 +0.33 n18 · 0.79 −0.20 n11; big 0.5 +0.21 · 0.618 +0.33 · 0.79 +0.25; BTC/ETH 0.5 +0.32 · 0.618 +0.19 · 0.79 +0.46. No level is best everywhere.
  - Review after ~20 live fib trades on the SMC Trader (compare with the small-caps backtest +0.29R).
- **Nov 19: SMC BTC/ETH account (Fred: narrow to one or two big coins).** "Add another trader that only does BTC/ETH, using our current SMC strategy, because the 365-day backtest was positive R." New paper account `SE` ($1,000) with SMC Big's settings (`SM.cfg` + `SB_OV`) on BTCUSDT + ETHUSDT only, the year backtest's setup (base +24.2R n89 on Nov 19). No rule or setting of any other account changed; SMC Big keeps its top-10 list. Compare live SE with the year backtest after ~20 trades.
- **Nov 19 (Trader stopped + Reviewer study):** Fred "momentum trader 可以停止交易". Migration `stop1119`: `PT.on = false` (no new entries; open positions still managed by `ptManage`). Report-only study of the Trader's small-cap trades for SMC lessons (state 2026-11-20 05:50 UTC; PT n328, SM n51, SB n16; halves = median entry time):
  - No Trader entry feature (score, funding, flow, OI, last hour, day move, time of day) separates its momentum or fade winners from losers in both halves; momentum n147 −0.17R; losers held 0.8 h vs winners 1.5 h.
  - Lead 1 (holds both halves on SM): SMC Trader longs on coins up on the day −0.53R n21 vs +0.17R n30 (same lesson as the Trader's Nov 15 fade study). Overlaps the 15–40% band (7 of 21) and flow-against (14 of 21). SB too few.
  - Lead 2: taker flow against the trade on SM −0.30R n24 vs +0.05R n27, both halves, gap shrinking (0.45R → 0.17R). SB opposite sign, too few.
  - 15–40% day move: −0.92R n11 but only 3 trades since Nov 12. SM opposite the Trader on the same coin ±6 h: −0.21R n17 vs +0.05R n16, one-sided. ~15 splits tested: leads, not rules. Next step offered to Fred: a test switch "no SMC Trader longs on day gainers", backtested like fib.
- **Nov 19 (EMA / MA / MACD / RSI study, report only):** `tools/smc-ind-study.mjs` reads 26 features per trade at t0 on CLOSED 15m / 1h bars (price vs EMA20 / EMA50, EMA20 vs EMA50, EMA50 slope, MACD line / histogram / rising, RSI with the trade + buckets, 1h price vs SMA50 / SMA200), signed with the trade. Base = rules in force, GT_END 2026-11-20 06:00 UTC: small caps 21 d n24 +6.9R, big caps 21 d n44 +5.2R, BTC/ETH 365 d n89 +24.2R.
  - None of 78 splits holds (≥ 0.15R, same sign both halves, n ≥ 8; ~2.0 expected by chance). SMC entries are already with the trend on almost every indicator (HTF + structure-shift rules), so the "against" cells are tiny.
  - Leads only: (1) 15m price on the wrong side of EMA20 (pullback entry) better in all 4 sets, but as a filter it cuts total R (small 4.3 vs 6.9, BTC/ETH 10.8 vs 24.2); (2) 1h price on the trade's side of SMA200: small 9.0 vs 6.9R, big 7.9 vs 5.2R, BTC/ETH 22.6 vs 24.2R (half 1 worse), live SM opposite. Fred: no indicator filter; re-run after ~20 more SMC Trader trades.
  - Fred, Nov 19: the "no SMC Trader longs on day gainers" test switch is on hold (not now).
- **Nov 20 (Fred, option A):** Trader, OpenInterest, Flow panels and the Gainer/Loser board tabs removed (UI only); data feeds kept for SMC cx / tracker / Reviewer; whale + liquidation feeds removed; Trader engine kept (stopped, still manages open positions, hosts the SMC ticks) — full Trader code removal (option B) waits until its positions close and Fred asks.
- **Nov 20 (Fred, walls):** the return race (north wall) shows only the three SMC accounts; the east wall shows SMC Big and SMC BTC/ETH open positions (two sections, each with its equity line) instead of the Trader's.
- **Nov 20 (unlock calendar stopped):** Fred "停埋個 Unlock calendar" (chose "stop everything"). Migration `nounl1120`: `unlGuard = 0` on `SM.cfg` (SMC Big and BTC/ETH inherit it) and `PT.cfg`; Unlock calendar tab removed from GainerLoser; `unlock-check` skill deleted. Fred pauses the claude.ai "Aster unlock calendar research" task himself. `unlocks.json`, `unlock.js` and `unlocks-publish.yml` stay (inert: nothing pushes `unlock-calendar/*` any more). `unlGuard 1` turns the guard back on, but only with a fresh calendar.
- **Nov 21 (GMS PMR v1.4, research only):** Fred asked to implement his playbook "1H pattern → 15m OB/FVG → 5m entry" with immutable timestamps, no look-ahead, rejection reasons, golden tests, and a backtest before any live use. Built as a separate module, **not on any account**: `bot/pmr.mjs` (deterministic state machine, `View` throws `LookAhead`), `tests/pmr-golden.mjs` (30 tests, in `npm test`), `tools/pmr-backtest.mjs` (1m fills, fees + spread + slippage + funding, replays every order on cut data). Details and interpretation choices: `docs/pmr-v1.4.md`; Backtester → Strategy notes.
  - 365 d BTC + ETH: 520 patterns, **2 trades** as written (−2.7R). Loosened (retest 4 h, MSS 90 min, POI ≤ 1 ATR, measured-move target): 11 trades, 0 wins, −14.0R; plus net R:R ≥ 1.5: 14 trades, 2 wins, −12.8R. Live SMC BTC/ETH rules, same window: +22.2R n88.
  - Look-ahead audit: 54 replays, 20 orders, 0 differences.
  - Fred "go 2" (try other coins): SMC Big top 10, 365 d: 15 trades −11.3R; 29 small caps, 180 d: 8 trades −5.2R. Loosened: big 51 trades −28.9R, small 61 trades +3.9R (halves −0.5 / +4.3). No version holds in both halves; no live change. Next: Fred decides whether to change the playbook itself (option 3) or leave PMR as research.
- **Nov 22 (GMS v1.4 switches + SMC Pattern account):**
  - Switches (report only): `closedOnly` / `retestExp` / `ltf5m` (`tools/smc-gms14-test.mjs`, `tools/out/gms14-results.md`) and `pat1h` 1 = 1h pattern filter / 2 = pattern trigger (`src/smc_pat.js`, `tools/smc-pat-test.mjs`, `tools/out/pat1h-results.md`): **all 0 on SM / SB / SE**. Leads only: `closedOnly` on BTC/ETH 365 d +22.7R n85 vs +22.2R n88 (both halves better, small margin); `pat1h 1` on BTC/ETH +23.2R n39 vs +19.7R n87 (half 2 worse). Small and big caps: nothing holds. `ltf5m` barely trades.
  - Fred "整多個trading agent 係v1.4既strategy 同埋睇1h 形態去做trade, 根據gainer loser 榜黎簡": new paper account `SP` "SMC Pattern (v1.4)" ($1,000, on from deploy, flag `sp1122`). `SP.cfg` = `SM.cfg` + `SP_OV` (`pat1h 2`, `closedOnly 1`, `gmsB/D 1`, `fib 0`, `ltf5m 0`); same stop / target / size / time-stop code. Coins: every hour the top 10 gainers + top 10 losers by 24 h % (`spPick`) among the board's coins with ≥ `CFG.trkMinVol` ($300K); direction from the pattern; held coins stay managed. `ltf5m 1` on any account now fetches live 5m klines for that account's coins only (`smK5Coins`, ≤ 20). Race wall + cloud cycle (`sp`, `cloud.spEq/spOpen`); no panel tab or review wall (Reviewer never learns from it, `sp|` keys). Backtest 21 d (`tools/smc-sp-test.mjs`, `tools/out/sp-results.md`): 2 trades +2.4R with ltf5m 0, 0 with ltf5m 1: too few to judge. Test: `tests/smc-sp.mjs`.
- **Nov 14 (year backtester):** option A: BTC / ETH only, SMC Big settings, 365 days, one account. Patterns are searched on the **raw** run (Reviewer rules off), so they are not just the rules' own leftovers (Fred). Report only. Spec/plan: `docs/superpowers/`.

## Open items
- **Start here (Nov 19), most urgent first:**
  1. ~~Unlock calendar~~: stopped Nov 20 (Fred), nothing to do.
  2. **Fade check is due:** 18 of ~20 fade trades so far, +0.11R avg (backtest +0.20R n103, live-reversed +0.49R n33). Review with Fred at ~20.
  3. **Part 3 of the Nov 16 request** (A or B, see Decisions): ask Fred.
  4. **3 unread reviews** (BULLA, ASTER, BNB): read them when Fred says "讀吓我啲 review".
  5. **Delete leftover test branches:** `claude/push-test-1794748419` and `push-test-1794748419` on the desk repo. Fred deletes them (scheduled sessions can't).
  6. **SMC checks:** SMC Trader B+D (8 of ~20 trades) and SMC Big C (13 of ~20) are not due yet.
  7. **Fib check (since Nov 19):** SMC Trader `fib 1`, review at ~20 trades (see Decisions, Nov 19).
  8. **PMR v1.4 (Nov 21):** research module only; as written it barely trades and loses on BTC/ETH, big caps and small caps (see Decisions). Fred decides what next.
- **Tests:** `tests/desk-smoke.mjs` now also checks the review chart: 5 timeframe chips, wheel zoom, switch to 1h, OB auto-box, 3 swing points, and the Reviewer reading LH/LL against a long plus an opposing OB as `room`.
  - Two older checks fail on and off, on code before Nov 16 too: "SB review changed SMC learning or awx_sm" and "Backtester changed live state".
  - Treat any other failure as real.
- **Nov 15 (OB pick test, waiting for Fred's call):** the live pick takes an OB only when the leg left no FVG (`SMZ_DEF.fvg 100`), so every live OB entry had no FVG after it. Test switch `SM.cfg.obPick` (live 0; `SB_OV.obPick` 0): 1 = a good OB (FVG after it, fresh, in discount/premium) is the zone, the OB∩FVG overlap when ≥ 0.1 ATR, and no zone when the leg has no FVG; 2 = only that last part. `tools/smc-obpick-test.mjs`:
  - small caps 14 d: base −10.1R n43 · obPick +0.3R n22 · noWeakOB −3.9R n33 (half 1 −0.7 vs −0.3, half 2 −9.4 vs +0.6);
  - big caps 14 d: base +7.3R n25 · obPick −6.6R n23 (worse both halves); BTC/ETH 365 d: base +13.8R n66 (+0.21) · obPick +7.7R n38 (+0.20);
  - replay of 18 live FVG trades with an OB candidate (`/tmp` study, same entry/stop/target rules): FVG −0.15R n16 vs OB +0.60R n13, mostly 2 trades (LYN +8.6, KGEN +4.7).
  - Good OBs themselves were ~0R in small caps (n15). Not adopted; Fred decides.
- **Nov 15 (entry timeframe test, report only):** 1h entries (4h filter) almost never trade. `tools/smc-obpick-test.mjs` variants `only1h` / `only1hRaw` (`SM.cfg.tf15 = 0`): small caps 14 d n1 (−1.0R), big caps 14 d n0, BTC/ETH 365 d n2 (+0.9R each); with 300 1h bars (`BT_H1BARS=300`, live loads 72) BTC/ETH n5 −0.79R; with Reviewer rules off BTC/ETH n15 −0.21R (15m raw n170). Of ~1,000 1h setups that reached the zone in a year, the blockers were the 4h regime (unclear / range position / against the trend, ~60%), quality C/D (~10%), needHTF, needPOI, depth. Side note: small caps 14 d, Reviewer rules off −2.6R n94 vs on −9.1R n44 (one window; on big caps and BTC/ETH the rules help).
- **Nov 15 (GMS v1.3 playbook switches, waiting for Fred's call):** `SM.cfg.gmsA/B/C/D`, all 0 live (see the comment above `smGmsAlign` in `src/smc.js`). A = 3-bar HTF swings, 15m trend plays need the 4h trending the same way, range plays a neutral 4h, bias = regime (needs 200 1h bars: `smBars` keeps the live 72 unless gmsA); B = sweep ≥ 0.05 ATR + close back within 2 closed bars, shift on a closed bar ≥ 0.05 ATR within 12 bars, displacement candle (body ≥ 1.2 ATR, ≥ 60%) required; C = HTF supply/demand from a 2–6 bar quiet base + ≥ 1.2 ATR departure, known after the departure closes, used zones are no POI; D = only FVGs ≥ 0.1 ATR with a displacement middle candle, OB = last opposite candle 1–4 bars before the displacement, never the zone. `tools/smc-gms-test.mjs` (base + 15 combinations, BT_H1BARS=200), total R vs base:
  - small caps 21 d: base −9.0R n55; best BD +0.3R n26 (both halves better), B −1.7R n29 (both halves), A/D/AB… better in one half only; C −14.6R n71 (worse both halves);
  - big caps 21 d: base +6.6R n37; C +6.6R n37; every other combination worse;
  - BTC/ETH 365 d: base +13.8R n66; C +28.0R n91 (half 1 +22.6 vs +7.2, half 2 +5.4 vs +6.5); CD +15.6R n44; BCD +13.0R n38; A, B, D alone worse.
  - No combination is better everywhere. SMC Big C and SMC Trader B+D adopted Nov 15 (Decisions).
- **Nov 15 (zone study, report only):** `tools/smc-zone-study.mjs` labels EVERY candidate FVG / OB of every setup (not only the traded zone) from the candles that followed (Reviewer label + a plain midpoint trade: zone stop, +2R, 12 h, net of costs). Small caps 21 d: 2,288 setups / 5,345 zones; big caps 21 d: 1,018 / ~2,000; BTC/ETH 365 d: 3,336 / 6,455. Regime-ok setups, avg R of the plain trade:
  - small caps: FVG with a displacement middle candle (`gq`, GMS D) +0.00 n303 vs −0.13 n1081, better in both halves; the only feature that holds. Pick "newest GMS-D FVG only" +0.06 vs live −0.06 (both halves).
  - OB never beats FVG; "good OB" (FVG after, fresh, discount) no better; the OB∩FVG overlap (A+) is worse (small −0.21, BTC/ETH −0.21) except big caps 21 d (+0.01). OBs with a displacement departure beat other OBs in small caps and BTC/ETH (both halves) but add nothing at trade level (`gmsD 2`: small −3.4R n34 vs D −4.6R n22, BD +0.3R n26).
  - Newest vs first FVG: no real difference; the live pick (newest FVG, else OB) stays. BTC/ETH and big caps: no zone feature holds in both halves.
  - So for small caps the lead is B+D (`gmsB`/`gmsD` 1): adopted Nov 15 (Decisions).
- **Background (Nov 15):** `docs/HANDOFF-2026-11-15.md` (what changed Nov 14–15, first year-backtest report, next steps).
- **SMC resumed Nov 13 06:05 UTC** (`resume1113`), with `zoneLearn` still 0. Fred's call: collect ~20 new trades under the regime gate, then check whether the proposed zone rule stays stable before unlocking it. It changed 4 times in the first hour of backfill. Latest proposal: avoid 0.10–1.20 ATR zones (−0.71R n20 vs +0.59R n13) and prefer displacement zones (+0.60R n6).
- Re-check the two SMC splits above once there are ~20 more SMC trades.
- **First year report, to read with Fred** (local 365-day run, Nov 14; report only, no rule changes without his yes):
  - Base (rules in force): n 66, +0.21R, 59% win, +13.75R total, max DD 4.95R.
  - Raw (all Reviewer rules off): n 184, −0.08R, 43% win, −15.2R, max DD 20.39R.
  - All 11 ablations: "no clear effect" (none passed 0.2R with both halves agreeing).
  - 5 patterns held (from raw), avg R first 8 months / last 4: wd Fri +0.62 / +0.12 (n 22 / 11); rrBand 2.5–3.5 +0.35 / +0.18 (n 29 / 8); atrT high +0.25 / +0.52 (n 50 / 11); rrBand <2.5 −0.18 / −0.14 (n 93 / 41); atrT low −0.27 / −0.48 (n 44 / 18).
  - Check-half samples are small (8–18 trades on the "this side" column): leads, not rules.
- Compare SMC Big vs SMC Trader in R, net of costs, once each has ~20 trades.
- Re-check OB vs FVG after ~20 more SMC trades: on Nov 13, OB −0.06R (n10) vs FVG −0.12R (n28). The OB bar at 80 may block almost every OB, so check how many OB setups get skipped for `obQ`.
- Momentum is the Trader's whole loss so far. Fred kept it on; raise it again only with new evidence.
- **Not done from the audit:**
  - feeding OI / flow into the SMC Trader;
  - flagging when the two traders hold opposite sides of a coin;
  - trimming the state file (~700 KB; the browser's localStorage write fails silently if it fills).

## Gotchas
- `renderPanel()` skips re-rendering while an input is focused or a chart drag is in progress (`RVP.drag`).
- New panel state that must survive re-renders lives in globals (`MD` = review draft, `RVP` = chart marking, `RVT` = tag toggle).
- Saved settings merge over defaults (`Object.assign({}, PT_DEF.cfg, saved)`). To force a new default onto existing accounts, use a one-time migration flag (see `ptMigrate` / `smMigrate`, e.g. `lev10`).
- The cloud and a browser can both trade; whoever holds `lock` trades. Before saving, a trader re-reads the ref and steps down if someone else took over.
- **Small caps are very fast.** 5-minute candles of 9% happen, and stops can fill in seconds. Judge results in R, net of fees (0.04%) and slippage (0.10%) per side.

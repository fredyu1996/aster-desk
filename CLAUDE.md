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
   - **"Aster unlock calendar research"**: daily 4:32 AM America/Creston.
     - Web-searches unlocks and updates the project doc.
     - **Clones this repo and pushes `unlocks.json` to a new branch `unlock-calendar/<date>-<time>`** (since Nov 16). The workflow `unlocks-publish.yml` checks the file (≥5 events, dates valid, not older than main, not less than half the events), commits it to main as "unlock calendar <date> (from unlock-calendar/…)" by github-actions[bot], and deletes the `unlock-calendar/*` branches.
     - Why a branch: a test on Nov 15 showed scheduled sessions **can create new branches but cannot delete them (HTTP 403)**, and their pushes to main did not land on Nov 12, 14 and 15.
     - Its message ends with "Desk repo updated via branch", "already up to date" or "DESK REPO NOT UPDATED: …".
     - So **`git pull` before you commit**; that commit lands every morning.
     - **History:** Nov 12, 14, 15 pushes to main did not land; Claude published those calendars by hand. Nov 13 landed (GitHub tool fallback).
   - **"Aster reversal watch"** (hourly dashboard): **paused** on Fred's request to cut usage. Its script is in `tools/reversal-watch.py`.
5. **The desk itself** shows "CLOUD QUIET · Xm" when the cloud has been silent for 20+ min. A connected browser takes over trading after 30 min of silence while it stays open.

## Build, test, deploy
```bash
npm install                      # once: three.js 0.149.0 (+ playwright for the smoke test)
python3 build.py                 # src/ → index.html + bot/core.js
node tests/smc-sweep.mjs         # SMC Trader logic in a Node vm: refuses a 15m short against a rising 1h, takes it when the 1h falls
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
| `smc.js` | **SMC Trader** paper account `SM` (and `SB`, SMC Big: `SB_OV` overrides, `smWith(SB, fn)` swaps the global `SM` around `fn`): `smcRead/smcReadTf/smSetup/smContSetup/smQuality/smTick/smManage`, HTF zones, POI, path, draw, PD high/low, `SM.cfg.regimeGate` (1 live; 0 only for the year backtest's ablation) |
| `scene.js` | three.js room, desks, wall screens (`SWALL` south wall = SMC positions, `RACE` north wall = return race) |
| `ui.js` | panels (`TABS`, `openPanel`, `renderPanel`), keys (1–7 agents, C coin check, V review wall, B SMC wall, T toggles ✓/✗ tags at the wall, E review it yourself) |
| `check.js` | coin check (key C) |
| `trader_ui.js` | Trader panels, position wall |
| `review.js` | **Reviewer** `RV`: grading, `rvRun/rvAnalyze/rvSticky`, Fred's reviews (`youRead/youReadM/youTally/planPoints`), SMC study/learning/coaching (`smStudy/smLearn/smCoach/smAudit`), 24 h follow-ups, screening criteria and memos. Everything above the marker `/* ================= REVIEWER: screens + panel` also goes into `bot/core.js` |
| `smc_ui.js` | SMC panels, SMC wall, return race |
| `bt_ui.js` | **Backtester** panel (key 7): read-only view of `smc-backtest-year.json` (base vs raw, ablation, patterns, months) |
| `lessons.js` | trade charts (`drawTradeChart`), `rvExplain` ✓/✗ items, review wall, "Your review" form, chart pictures, **"Mark my own setup"** (`rvPlanSim`, `drawPlan`), `rulesNow` |
| `sync.js` | GitHub sync (`state` and `notes` branches), roles/lock, chart-picture storage (IndexedDB + `img/` on notes) |

## The agents (desk keys)
1. **GainerLoser**: movers boards, pattern tags, day tracker, unlock calendar, settings.
2. **OpenInterest**: OI spikes and regime.
3. **Flow**: taker flow, funding, whales, liquidations.
4. **Trader** ($1,000 paper):
   - Reversal: shorts gainers at "Reversal forming / Reversed" with ≥5/8 signs. Reversal longs are **off** (Fred, Nov 8).
   - Momentum: both sides at ≥6/8.
   - Risk: 1% per trade, max 3 positions, half off at +1.5R, target +3R, fade exits after 30 min, 12 h time stop, unlock guard, uses the Reviewer's screens.
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
   - Desk: SMC panel (key 6) has a Small caps / Big caps switch with its own on/off toggle; the return race wall has a third line and an SMC BIG stats column.
   - The 7-day backtest also writes `smc-backtest-big.json` (report only; paused since Nov 14, last file stays readable).
   - A browser on the pre-deploy desk that takes the lock saves state without `sb`, and SB restarts fresh: hard refresh after a deploy.
8. **Backtester** (key 7, report only):
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
  - **✏️ Mark my own setup**: side, entry, stop, target, zones, lines, labels, stored as prices and times in `plan`.
- **How a review is read** (`youReadM`):
  1. If Claude has read the review (`rd`, below) and the text is unchanged, that reading is used.
  2. Otherwise the phrase reader `youRead(text, side)` runs over the comment + captions (English + Cantonese, side-aware: "should have been a short" on a long → `flip`).
  3. Points from the chart plan are added (`planPoints`: other side → flip; entry ≥0.25R deeper → later + depth; stop ≥0.2R out/in → wider/tighter; target ≥30% short / 40% past → exitE/hold).
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

## State on Nov 12, 2026 (20:15 UTC, cloud run ~795)
| | Equity | Trades | Wins | Avg R |
|---|---|---|---|---|
| Trader | $935 | 129 | 48 | −0.08 |
| · reversal | | 50 | 22 | +0.01 |
| · momentum | | 79 | 26 | −0.13 |
| SMC Trader | $965 | 30 | 12 | −0.12 |

- **SMC rules in force (Reviewer):**
  - HTF must agree;
  - midpoint entries;
  - only from an HTF zone or swing (`needPOI`);
  - quality ≥ 70 (Nov 13); order blocks ≥ 80 (`obQ`, Nov 13);
  - half at +1.2R;
  - stop 0.6% beyond the sweep.
- **Trader rules in force:** target +2R; skip "Short squeeze" setups.

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
- **Nov 14 (year backtester):** option A: BTC / ETH only, SMC Big settings, 365 days, one account. Patterns are searched on the **raw** run (Reviewer rules off), so they are not just the rules' own leftovers (Fred). Report only. Spec/plan: `docs/superpowers/`.

## Open items
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
- **Start here (Nov 15):** read `docs/HANDOFF-2026-11-15.md` (what changed Nov 14–15, first year-backtest report, next steps).
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
- **Unlock publish:** after 4:32 AM Creston each day, check the repo has a fresh "unlock calendar" commit (`git log -3 -- unlocks.json`). If not, look at the `unlocks-publish.yml` run (a refusal says why) and for leftover `unlock-calendar/*` branches; otherwise the calendar on the desk is stale: copy the claude.ai project doc `claude/unlocks.json` here, run `python3 build.py` and push. Or ask Fred to run that research from Claude Code instead.

## Gotchas
- `renderPanel()` skips re-rendering while an input is focused or a chart drag is in progress (`RVP.drag`).
- New panel state that must survive re-renders lives in globals (`MD` = review draft, `RVP` = chart marking, `RVT` = tag toggle).
- Saved settings merge over defaults (`Object.assign({}, PT_DEF.cfg, saved)`). To force a new default onto existing accounts, use a one-time migration flag (see `ptMigrate` / `smMigrate`, e.g. `lev10`).
- The cloud and a browser can both trade; whoever holds `lock` trades. Before saving, a trader re-reads the ref and steps down if someone else took over.
- **Small caps are very fast.** 5-minute candles of 9% happen, and stops can fill in seconds. Judge results in R, net of fees (0.04%) and slippage (0.10%) per side.

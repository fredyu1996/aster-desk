# Big-cap SMC Trader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second paper SMC account `SB` that runs the unchanged SMC strategy on the 10 highest-volume Aster perps, plus a big-cap backtest, so Fred can compare the strategy on big vs small caps in R.

**Architecture:** One strategy implementation. `smWith(acct, fn)` swaps the global `SM` (and the read cache `S.smC`) to `SB` for the duration of `fn` and always restores it. Inside the swap, `smTick` scans `smCoins()` instead of `S.trk`, and `SB.cfg` is rebuilt each swap as small-cap settings + `SB_OV` overrides. Every reader outside the swap still sees the small-cap account.

**Tech Stack:** plain browser JS concatenated by `build.py` (src/ → index.html + bot/core.js), Node 22 for cloud/backtest/tests, Playwright smoke test.

**Spec:** `docs/superpowers/specs/2026-11-13-bigcap-smc-design.md`

## Global Constraints
- Paper only. Never edit `index.html` / `bot/core.js` by hand; run `PYTHONUTF8=1 py build.py` and commit them with the source.
- Small-cap `SM`: same decisions, same state, same localStorage writes for the same inputs (anti-goal: any change to it).
- `SB_OV = {minStopPct: 0.5, slipPct: 0.02, stopBufMul: 0.25, tightPct: 0.4}`. Everything else in `SB.cfg` = live copy of `SM.cfg`.
- Leverage: unchanged sizing (1% risk, 10× total cap, `maxLev / maxPos` per position).
- `SB` starts `on: true`, $1,000.
- Reviewer never learns from `SB` (`smLearn`, `rvRun`, coaching, zone tuner read only `SM`).
- `src/*.js` files are CRLF; keep line endings when editing.
- `git pull --rebase` before every commit (the unlock task pushes daily). Commit and push in separate calls.

## Review Focus
1. An exception inside `smTick` while swapped → `SM` must still be the small-cap account afterwards (test in Task 1).
2. A coin held by `SB` that later enters `S.trk` → both accounts read it; their reads must not share `S.smC` (test in Task 1).
3. A fresh cloud state with no `sb` key → `SB` starts at defaults with `on: true`, no crash (test in Task 2).
4. Fewer than 10 non-stock perps with tickers (API hiccup) → `smBigList` returns what exists, no throw (test in Task 1).
5. Rendering the SMC panel in big-cap mode must not write state (no `smSave`, no `RV` change) — render is read-only (test in Task 4).

---

### Task 1: SB account, swap, overrides, coin list (core)

**Files:**
- Modify: `src/smc.js` (SM_DEF/load/save :12-27, `smTryEnter` raise :556, trail :592, `smTick` :597-649 incl. coin loops :605 :637 and floor :629, `smRules` :684)
- Modify: `src/trader.js:248` (call after `smTick()`)
- Test: `tests/smc-bigcap.mjs` (load `bot/core.js` in a vm the way `tests/smc-sweep.mjs:5-7` does)

**Interfaces — Produces:**
- `const SB_OV` (values above); `let SB` loaded from `LS.get('awx_sb')`, merged over `SB_DEF` (= `SM_DEF` copy with `on: true`, `cfg: {}`).
- `smWith(acct, fn) -> any`: if `acct === SB`: set `SB.cfg = Object.assign({}, SM.cfg, SB_OV)`, swap `SM`↔`SB` and `S.smC`↔`S.smCB` (new Map), run `fn`, restore in `finally`, return `fn()`'s value. If `acct` is the small-cap account, just `fn()`.
- `smBigList(n = 10) -> string[]`: `S.meta` symbols with an `S.tk` entry, not stock unless `CFG.includeStocks` (same stock test as `eligible()` in `src/engine.js:168`), not in `S.trk`, sorted by `S.tk.get(s).qv` desc, first `n`.
- `smCoins() -> string[]`: `SM === SB` ? unique `[...smBigList(), ...Object.keys(SB.pos)]` : `Object.keys(S.trk)`.
- `smName() -> 'SMC Big' | 'SMC Trader'` used in the `raise('smc', …)` texts (:537 :538 :556 :603).
- `smSave()` writes `'awx_sb'` when `SM === SB`, else `'awx_sm'`.

- [ ] **Step 1: Write the failing tests** in `tests/smc-bigcap.mjs`:
  - `bigList`: fake `S.meta`/`S.tk` with 15 coins (2 stocks, 2 in `S.trk`, qv distinct) → `smBigList()` has length 10, sorted by qv, contains no stock and no trk coin; with 4 eligible coins → length 4.
  - `overrides`: inside `smWith(SB, …)`: `SM.cfg.minStopPct === 0.5`, `SM.cfg.slipPct === 0.02`, `smRules().stopBuf === 0.25 * <smRules().stopBuf outside>`; outside: `SM.cfg.minStopPct === 1.5`.
  - `restore`: `smWith(SB, () => { throw Error('x') })` throws, then `SM.cfg.minStopPct === 1.5` and `S.smC` is the original Map.
  - `isolation`: build the smc-sweep fixture (15m short setup, falling 1h), run `smTick()`; snapshot `JSON.stringify(SM)` minus `eqs`/`lastScan.t` and `localStorage awx_sm`. Reset, run `smTick(); smWith(SB, smTick)`; same snapshot must be equal; `awx_sb` exists.
  - `cache`: a coin in both `S.trk` and `SB.pos` → after `smTick(); smWith(SB, smTick)` the small-cap `S.smC.get(coin)` equals the read from a run without the SB tick.
- [ ] **Step 2:** `PYTHONUTF8=1 py build.py && node tests/smc-bigcap.mjs` → FAIL (`SB is not defined`).
- [ ] **Step 3: Implement** the Produces block. Trail at :592 multiplies `SM.cfg.stopBuf` by `(SM.cfg.stopBufMul || 1)`; `smRules` :684 multiplies its returned `stopBuf` (Reviewer value or fallback) the same way; floor :629 uses `(SM.cfg.tightPct || 0.6) / 100` and its skip text; `smTick` loops :605 and :637 use `smCoins()`. `ptTick` (`src/trader.js:248`): `smTick(); smWith(SB, smTick);`.
- [ ] **Step 4:** build, then `node tests/smc-bigcap.mjs && node tests/smc-sweep.mjs && node tests/smc-regime.mjs && node tests/smc-zones.mjs` → all PASS.
- [ ] **Step 5: Commit** `SMC Big: second SMC account on the top-10 volume perps (core)`.

### Task 2: Data and state plumbing (desk + cloud)

**Files:**
- Modify: `src/engine.js` (h1 job site :210-212, universe build :186-188)
- Modify: `src/sync.js:31` (bundle) and `:37` (apply)
- Modify: `bot/run.mjs` (:61 load, :91 coin set, :99-100 replay, :145-146 output)
- Test: `tests/cloud-dry-run.mjs`

**Interfaces — Consumes:** `SB`, `SB_DEF`, `smWith`, `smCoins`, `smBigList`, `smMigrate` from Task 1.

- [ ] **Step 1: Extend the failing test** in `tests/cloud-dry-run.mjs`: after a run from `{}`: `out.sb` exists, `out.sb.on === true`, `out.sb.start === 1000`, `out.sb.cfg.minStopPct === 0.5`; `out.cloud.sbEq` is a number; `out.sm` unchanged in shape. Second run feeding `out` back in keeps `out.sb.created`.
- [ ] **Step 2:** run it → FAIL (`out.sb` undefined).
- [ ] **Step 3: Implement.**
  - engine.js: h1 jobs use `new Set([...h1set(), ...smBigCoins()])` where `smBigCoins()` = `typeof smBigList === 'function' ? [...smBigList(), ...Object.keys(SB.pos)] : []`; in the universe build add `smBigCoins()` right after `prio`, before the qv fill. **`h1set()` and `S.prio` stay unchanged** (spec: momentum scan + aggTrade cap).
  - sync.js: bundle adds `sb: SB`; apply: `if (b.sb) { SB = Object.assign(JSON.parse(JSON.stringify(SB_DEF)), b.sb); smWith(SB, smSave); }`.
  - run.mjs: `['awx_sb', b && b.sb]` at :61; coin set :91 adds `smBigCoins()`; replay list adds `{pos: 'SB.pos', mng: '((t, o) => smWith(SB, () => smManage(t, o)))', tp1: "q.tp1 ? null : q.entry + dir * SB.cfg.tp1R * d", tgt: "q.target"}`; output `sb: X('SB')`, cloud stats `sbEq: X('smWith(SB, smEquity)')`, `sbOpen: X('Object.keys(SB.pos).length')`.
- [ ] **Step 4:** build, `node tests/cloud-dry-run.mjs` → PASS; then the real-price cycle from CLAUDE.md (`STATE_IN=<scratch>/st.json STATE_OUT=<scratch>/out.json node bot/run.mjs`) and check `out.sb.lastScan.cands` names ≤ 10+held coins, none in `out.trk`.
- [ ] **Step 5: Commit** `SMC Big: candles, state sync and cloud cycle`.

### Task 3: Big-cap backtest + Reviewer block

**Files:**
- Modify: `bot/backtest.mjs` (:14 consts, :31-39 `writeOut`, `trkHour` :88-95, coin set :169, `simulate` :107-143, main :160-212)
- Modify: `src/sync.js:249-255` (`btPull`, `btHTML`), `src/lessons.js:635`
- Test: `tests/bt-universe.mjs`

**Interfaces — Produces:** `trkHour` return gains `big: string[]` (`X('smBigList()')` after `recomputeUniverse()`); `simulate(..., {big: true})` runs `smWith(SB, smTick)` / `smWith(SB, () => smManage(...))` on `u.big` instead of `u.trk`; `writeOut(files: {[path]: object})` commits all files in one parentless commit. Files: `smc-backtest.json` (unchanged) and `smc-backtest-big.json` (same schema).

- [ ] **Step 1: Failing test** in `tests/bt-universe.mjs`: `trkHour(...)` result has `big` of length ≤ 10, disjoint from `Object.keys(result.trk)`, no stock symbols.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Candles for the union of `u.big` across hours load with the trk coins (:169-171). Main runs base then big from the same candles, one `writeOut` with both files. Workflow stays one step (timeout 45 min).
- [ ] **Step 4:** `node tests/bt-universe.mjs` → PASS; local `BT_DAYS=2 node bot/backtest.mjs` with a local out (no token: whatever dry mode it already has) prints both reports; note trade counts.
- [ ] **Step 5:** `btPull` fetches both files; `btHTML` renders the big one as a second block titled "BIG CAPS · BACKTEST (PROPOSAL ONLY)". Smoke-test fixture gets a fake big file.
- [ ] **Step 6: Commit** `SMC Big: nightly big-cap backtest, report only`.

### Task 4: Desk UI — switch and race line

**Files:**
- Modify: `src/smc_ui.js` (`smcHTML` :97, `drawRace` :256-258)
- Modify: `src/ui.js:302-303` only if the switch click handler lives there
- Test: `tests/desk-smoke.mjs`

**Interfaces — Produces:** global `SMV = 'sm' | 'sb'` (default `'sm'`, not persisted). `smcHTML(tab)` renders a two-button switch "Small caps | Big caps" at the top, then the body via `SMV === 'sb' ? smWith(SB, () => body(tab)) : body(tab)`.

- [ ] **Step 1:** Before coding, list everything `smcHTML`'s tabs call; any tab that writes (`smSave`, `RV.` assignment, `smLearn`) is hidden in big mode. Write the list in the commit message.
- [ ] **Step 2: Failing smoke test:** open SMC panel, click "Big caps", visit every visible tab, assert no page errors and `localStorage awx_sm` unchanged byte-for-byte across the clicks; RACE wall draws three labelled lines (assert via a `RACE.lines === 3` debug field or the legend text).
- [ ] **Step 3: Implement** the switch, `drawRace` third line from `SB.eqs` + `smWith(SB, smEquity)`, label "SMC Big".
- [ ] **Step 4:** build, `node tests/desk-smoke.mjs` → PASS; take a Playwright screenshot of the SMC panel in big mode and of the race wall, look at both.
- [ ] **Step 5: Commit** `SMC Big: desk switch and race line`.

### Task 5: Docs, deploy, first live check

**Files:** `CLAUDE.md` (agents list, state table, source map line for smc.js), `docs/smc-backtest.md`, `docs/smc-playbook.md` (one paragraph on SB_OV and why).

- [ ] **Step 1:** docs edits; all tests once more: `node tests/smc-bigcap.mjs && node tests/smc-sweep.mjs && node tests/smc-regime.mjs && node tests/smc-zones.mjs && node tests/bt-universe.mjs && node tests/cloud-dry-run.mjs && node tests/desk-smoke.mjs`.
- [ ] **Step 2:** `git pull --rebase`, commit `CLAUDE.md: SMC Big`, then push (separate call).
- [ ] **Step 3:** wait for the next cloud run (≤ 5 min), read the state branch via the public Actions log / `gh run view`, confirm the run succeeded and its log shows the SB cycle; dispatch `smc-backtest.yml` once and confirm the backtest branch holds both files.

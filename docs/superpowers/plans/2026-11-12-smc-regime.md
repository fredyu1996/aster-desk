# SMC regime gate + pause + self-review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pause the SMC Trader, gate every SMC entry on an HTF regime (up/down/range/fakeout), record the play, and produce a self-review of all past SMC trades.

**Architecture:** `smRegime(B)` in `src/smc.js` reads closed HTF bars with the existing `smPivots`. `smcReadTf` attaches it to the read; `smTick` skips mismatches; `smTryEnter` stores `regime`/`play`; the close path copies them to the log. `smStudy` in `src/review.js` gains new groups. An offline Node script replays past trades.

**Tech Stack:** plain browser JS built by `build.py` into `index.html` + `bot/core.js`; Node vm tests.

**Spec:** `docs/superpowers/specs/2026-11-12-smc-regime-design.md`

## Global Constraints
- Edit `src/` only, then `python3 build.py` (or `python build.py` on Windows); commit source + built `index.html` + `bot/core.js` together.
- Paper only. No change to `PT`, sizing, leverage, fees.
- Range edge = 30%. Fakeout lookback = 3 closed HTF bars. Null regime → no trade.
- Forming HTF bar excluded: a 1h bar counts only if `t + 1h <= now`; a 4h bar only if `t + 4h <= now` (use `SM_OVR.t` when auditing).

## Review Focus
- Coin with <12 closed HTF bars (new listing) → regime null → skip text "regime unclear", no crash.
- Equal swing highs (H2 == H1) → range, not up.
- Fakeout bar that is also a new swing → fakeout wins (precedence fakeout > trend > range).
- Continuation setup (`type: 'cont'`) in a range → skipped unless at range edge rule allows its side.
- Old log rows without `regime` → `smStudy` groups them as `?`, no NaN.

---

### Task 1: `smRegime` + gate + record

**Files:**
- Modify: `src/smc.js` (after `smBiasB` ~line 59; `smcReadTf` ~283-346; `smTick` skip chain ~504; `smTryEnter` pos object ~446; log row ~425)
- Test: `tests/smc-regime.mjs` (new, copy the vm harness from `tests/smc-sweep.mjs`)

**Interfaces:**
- Produces: `smRegime(B) -> {reg: 'up'|'down'|'range'|'fakeout_up'|'fakeout_dn'|null, hi, lo, why}`; `smRegimeOk(reg, dir, px) -> {ok: bool, play: 'trend'|'range'|'fakeout'|null, why}`. Read object gains `regime` (the smRegime result) and `rok` (smRegimeOk result). Position and log rows gain `regime` (string) and `play` (string).

- [ ] Step 1: Write failing tests in `tests/smc-regime.mjs` (pure-function cases on synthetic bars, plus one smTick case reusing smc-sweep's SWEEPUSDT 15m long setup):
  - drop-base-drop 1h (LH+LL) → `smRegime().reg === 'down'`; smTick with the 15m long setup → no position, `SM.lastScan` skip mentions regime.
  - HH+HL 1h → `'up'`, `smRegimeOk('up','L',px).ok === true`, `smRegimeOk('up','S',px).ok === false`.
  - mixed swings, price at 50% of range → `'range'`, both sides `ok === false`; price at 20% → long ok with `play === 'range'`, short not.
  - last 3 bars: one closes above range hi, latest back inside → `'fakeout_up'`; short ok `play === 'fakeout'`, long not.
  - 8 bars only → `reg === null`, ok false.
  - equal highs H2 == H1 with higher lows → `'range'`.
  - forming bar excluded: a last 1h bar with `t + 1h > now` that would flip regime does not change the result.
- [ ] Step 2: `python build.py && node tests/smc-regime.mjs` → FAIL (smRegime not defined).
- [ ] Step 3: Implement per the spec's regime definition. Gate in `smTick` placed right after the cooldown check: `else if (!r.rok || !r.rok.ok) c.skip = 'HTF regime <reg>: ' + r.rok.why`. For `play === 'fakeout'` skip the `r.against`, `needHTF` and `poiRule` bias checks. HTF quality/score item: `ok` = `r.rok.ok`. Only build cont candidates when regime is up/down matching side. Add `regime`, `play` to pos and log row; add regime to `why` text and `SM.lastScan` rows.
- [ ] Step 4: `node tests/smc-regime.mjs`, `node tests/smc-sweep.mjs` (update its expectations only if the falling-1h case is now classified otherwise; say why in the commit) → PASS.
- [ ] Step 5: commit "SMC: HTF regime gate (trend/range/fakeout), record play".

### Task 2: pause migration

**Files:** Modify `src/smc.js:15` (`smMigrate`). Test: add to `tests/smc-regime.mjs`.
- [ ] Step 1: test: `smMigrate({cfg:{ownJudge:1,lev10:1}, on:true})` → `on === false`, `cfg.pause1113 === 1`; calling again after `on = true` keeps `on === true`. And with an open position, `smManage` still closes it at its stop.
- [ ] Step 2: run → FAIL. Step 3: add `if (p.cfg.pause1113 !== 1) { p.on = false; p.cfg.pause1113 = 1; }` with comment "Nov 12 (Fred): stop new SMC entries for the self-review; resume by hand". Step 4: PASS. Step 5: commit.

### Task 3: Reviewer groups

**Files:** Modify `src/review.js` `smStudy` (~317-324). Test: add to `tests/smc-regime.mjs`.
- [ ] Step 1: test: `smStudy` over a fake log of 6 rows (2 with play trend, 2 range, 2 without regime) returns groups keyed `play` {trend, range, ?}, `stopPct` buckets {'<2%','2–4%','>4%'} (from `|entry-stop0|/entry`), `rr` buckets {'<2.5','2.5–3.5','>3.5'}, each with n and avg R; no NaN.
- [ ] Step 2 FAIL → Step 3 implement following the existing group pattern → Step 4 PASS → Step 5 commit.

### Task 4: full checks + push

- [ ] `python build.py`, `npm test`, `node tests/smc-sweep.mjs`, `node tests/smc-regime.mjs`, `node tests/desk-smoke.mjs`, cloud dry-run (`STATE_IN` with `{}`); paste pass lines.
- [ ] `git pull --rebase` then push.

### Task 5: self-review report (Claude, after Task 1 is built)

- [ ] Script `tools/smc-self-review.mjs <state.json> <out.json>`: for each `sm.log` row, fetch Aster `/fapi/v1/klines` 1h (`endTime = t0`, limit 120) and 15m (limit 200), build 4h with `smAgg`, run `smRegime` on the trade's HTF, `smRegimeOk` for its side. Output per trade: regime, ok, play, tf, zoneKind, q.score, dz, stopPct, rr, maxR, R, exitWhy.
- [ ] Report page: entry TF + timing (dz buckets), OB vs FVG, quality bands, stop % vs stop-outs and maxR, RR vs target hit, momentum vs reversal, regime-mismatch trades and their R. Every figure with n.

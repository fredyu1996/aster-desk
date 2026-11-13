# SMC Trader: pause, HTF regime gate, self-review (2026-11-12)

## Intent
Fred saw the SMC Trader take longs inside drop-base-drop structure (and shorts in the mirror case).
Its HTF "bias" is only the side of the last close beyond a swing point, so one counter close flips it,
and a null bias passes. He wants it to (1) stop opening trades once the current open positions close,
(2) review itself on entry TF/timing, OB/FVG quality, SL and TP distance, and whether each trade was
momentum or reversal, and (3) from now on read the HTF regime first and trade only the matching play.

## Goals
- Pause: no new SMC entries after deploy; open positions still managed to exit. Resume only when Fred says so.
- `smRegime`: classify the HTF as up / down / range / fakeout_up / fakeout_dn / null, from closed bars only.
- Hard gate: up → long only; down → short only; range → long only in lower 30% of range, short only in
  upper 30%; fakeout_up → short only; fakeout_dn → long only; null → no trade.
- Store `regime` and `play` (trend = momentum; range / fakeout = reversal) on every new position and log row.
- Reviewer (`smStudy`) groups by play, regime match, stop distance %, and planned RR, so it keeps checking.
- One-off report: replay regime for every past SMC trade from historical Aster klines and grade entry
  TF/timing, zone quality, SL distance, TP distance, momentum vs reversal. Every number with its n.

## Non-goals
- No change to the Trader (`PT`), sizing, leverage cap, or fees.
- No OI / flow inputs (still on the open list).
- No automatic resume.

## Anti-goals
- A gate that silently lets null/unknown regimes through (the bug being fixed).
- Using the forming HTF bar for regime (lookahead / flicker).

## Regime definition (HTF = 1h for 15m setups, 4h for 1h setups)
- Swings: the existing fractal (L=2) on closed HTF bars only.
- Last two swing highs H1 (older), H2 and lows L1, L2.
- up: H2 > H1 and L2 > L1, and the last close is still above L2.
- down: H2 < H1 and L2 < L1, and the last close is still below H2.
- range: anything else with enough swings. Range = [min of recent swing lows, max of recent swing highs].
- fakeout: within the last 3 closed HTF bars a close went beyond the range high (or low, or the last
  swing high/low), and the latest close is back inside → fakeout_up / fakeout_dn. Fakeout beats trend
  beats range.
- Too few bars or swings → null → no trade.
- On fakeout trades the old bias check is bypassed (a fakeout is against the last break by definition).

## Approaches considered
- Hard gate (picked): directly stops the wrong-side trades; fewer trades.
- Score-only penalty: still lets wrong-side trades through. Rejected because it contradicts the request.
- Report-only, no Reviewer change: rejected because future checks would be lost.

## Pause mechanics
- One-time migration flag in `smMigrate` sets `SM.on = false` (exits keep running in `smManage`).
- Resume: an SMC panel toggle if one exists, else add one. Or Claude flips it on Fred's word.

## Verification
- New test `tests/smc-regime.mjs`, built on the `smc-sweep.mjs` vm pattern: drop-base-drop 1h + 15m long
  setup → no position; uptrend → long allowed; range middle → no trade; fakeout above range → short allowed;
  insufficient bars → no trade; migration leaves `SM.on` false while open positions still close.
- Existing `npm test`, `smc-sweep`, desk smoke and cloud dry-run must still pass.

## Left to the builder
- Exact placement of the gate in `smTick` and how the HTF score item maps onto regime agreement.

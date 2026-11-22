# GMS PMR v1.4: Pattern-Anchored Multi-timeframe Refinement (research module)

Fred's playbook (Nov 21, 2026). **Research / backtest only:** no account trades it.
- Code: `bot/pmr.mjs`
- Golden tests: `tests/pmr-golden.mjs` (in `npm test`)
- Backtest: `tools/pmr-backtest.mjs`

This note covers what was built, the interpretation choices where the playbook left room, and the first results. The playbook itself is Fred's file and is not copied here.

## Chain (event time = bar close, UTC)
1. **1h pattern (parent event).** On each closed 1h bar, look for a breakout of a boundary drawn only from pivots confirmed **before** that bar.
   - Pivots: left = right = 3.
   - The close must be beyond the boundary by ≥ 0.10 × ATR1h (prior).
   - The event is frozen when it fires: `pattern_id`, `confirmed_at`, boundary line, `boundary_at_t`, ATR, measured-move target, 4h bias, group.
   - Near misses are logged: `WICK_ONLY`, `BREAKOUT_TOO_SMALL`.
2. **15m POI (causal).** A displacement candle in the pattern's direction among the last 8 closed 15m bars at `confirmed_at`.
   - Displacement candle: body ≥ 1.2 ATR15 (prior), body/range ≥ 0.6.
   - **FVG:** the displacement candle is C2, gap ≥ 0.10 ATR. It is known only once C3 closes.
   - **OB:** only if a 15m close broke the last confirmed 15m swing within 2 bars of the impulse. It is the last opposite-colour candle 1–4 bars before the impulse (full range), known when that break closed.
   - Each zone must be ≤ 0.5 ATR1h from the boundary and untouched since it became known.
   - If there is none at t0, the next 2 closed 15m bars may add one, with its own later `known_at`.
   - Pick order: closest to the boundary, then newest. OB/FVG overlap ≥ 20% feeds the A+ label only.
   - Codes: `SKIP_POI_NOT_CAUSAL`, `SKIP_POI_TOO_REMOTE`, `SKIP_USED_ZONE`, `SKIP_POI`, `NO_POI`.
3. **Retest.** The first 5m bar that touches the POI after t0, within 120 min. Otherwise `EXPIRED_NO_TOUCH`.
4. **5m MSS.** Within 45 min of the touch, a 5m close beyond the last confirmed 5m swing by ≥ 0.05 ATR5, with a displacement candle in the leg from the retest extreme. Otherwise `NO_LTF_CONFIRMATION`.
5. **Entry FVG.** The first displacement FVG whose C1 is at or after the touch bar, with C3 closed no later than 15 min after the MSS.
   - The order is active only from max(C3 close, MSS) and never earlier.
   - FVGs completed before the touch are logged `REJECT_AS_ENTRY_FVG`.
   - Entry = FVG midpoint.
   - Stop = beyond the more conservative of the retest extreme and the POI's far edge, plus 0.15 ATR5.
   - Target = the measured move, or a nearer opposing 1h swing.
   - Net R:R after costs must be ≥ 2, otherwise `SKIP_RR`.
6. **Pending → fill → exit.**
   - 60 min to fill on 1m bars (`EXPIRED_NO_FILL`).
   - Pre-entry cancels: a 1h close back inside the boundary, or a 15m close beyond the POI's far edge.
   - A fill that came before a cancel stands.
   - After the fill: hard stop, target, or 24 h time exit on 1m bars. If a minute touches both stop and target, the stop counts first; the fill minute never takes the target.

## Interpretation choices (the playbook leaves these open)
- **Pattern geometry** (`P.pat`), all on confirmed 1h pivots:
  - Double top / bottom: 5–40 bars apart, tops within 0.6 ATR, height ≥ 1.5 ATR, a prior move of ≥ 2 ATR.
  - H&S: head ≥ 0.3 ATR beyond both shoulders, sloped neckline through the two troughs, evaluated bar by bar.
  - Triangle: last 2 highs + 2 lows, ascending / descending / symmetrical, each line spanning ≥ 40% of the triangle, either breakout direction.
  - Flag: a pole ≥ 3 ATR within 12 bars, a pullback ≤ 50% over 4–25 bars, a boundary through the flag's extreme pivot and the latest lower pivot.
- **Retest on 5m bars** instead of 15m closes: finer, still causal.
- **Opposing liquidity = unswept 1h swings** (`oppUnswept 1`). A swing the breakout has already traded through is not resistance. Literal reading (`oppUnswept 0`): 1 trade instead of 2.
- **Time exit 24 h.** One setup per coin at a time (`BUSY`).
- **Costs per side:** fee 0.04% + half spread 0.01%; slippage 0.02% on stop / time exits; Aster funding while held.
- **4h bias** (closed 4h pivots: HH+HL up, LH+LL down, else range):
  - reversal patterns that go against it are grouped `COUNTERTREND_ALLOWED`;
  - continuation patterns are grouped `TREND` / `RANGE_4H` / `AGAINST_4H`.
  - It is reported only, never a gate.
- **A / A+** is a label only. A test checks that no decision reads it.

## Look-ahead protection
- Every bar read goes through `View.b(i)`, which throws `LookAhead` for a bar not closed at the view's time.
- ATR(i) uses only bars before i. A pivot is visible only after its confirming bar closes.
- `tools/pmr-backtest.mjs` replays every order (and a sample of the other setups) on series **cut** at the decision time. The pattern, POI and order must be identical. Nov 21 run: 54 replays, 20 orders, 0 differences.
- Timestamp audit: retest > t0 and ≥ POI `known_at`; C3 > retest; active ≥ C3 and ≥ MSS; fill ≥ active; exit > fill.

## Results, Nov 21 (BTCUSDT + ETHUSDT, 2025-11-21 → 2026-11-21 23:00 UTC)
| Variant | Trades | Wins | Total R |
|---|---|---|---|
| As written (`oppUnswept 1`) | 2 | 0 | −2.7 |
| Measured-move target only (`oppLook1h 0`) | 6 | 0 | −7.5 |
| Retest 4 h + MSS 90 min | 2 | 0 | −2.7 |
| POI ≤ 1 ATR | 2 | 0 | −2.7 |
| All four loosened | 11 | 0 | −14.0 |
| All four + net R:R ≥ 1.5 | 14 | 2 | −12.8 |

- **Funnel, as written:** 520 patterns.
  - No fresh causal POI: 227.
  - No retest in 2 h: 131.
  - No MSS in 45 min: 70.
  - Invalidated before the fill: 70.
  - R:R < 2: 17.
  - No entry FVG: 2.
  - Not filled: 1.
  - Filled: 2.
- In the loosened variants most trades stopped before +1R. Stops are tight (0.25–0.7%), so costs make each stop about −1.2R.
- For comparison, the live SMC BTC/ETH rules (SMC Big settings) in the same window's year backtest: +22.2R n88.

### Other coins (Nov 21, same rules)
| Universe | Window | Patterns | As written | Loosened (all four) |
|---|---|---|---|---|
| SMC Big top 10 by volume (BTC, ETH, SOL, ASTER, HYPE, XRP, DOGE, ZEC, BNB, IDOL) | 365 d | 2,487 | 15 trades, 2 wins, −11.3R (halves −7.3 / −3.9) | 51 trades, −28.9R (halves −19.9 / −9.0) |
| 29 small caps (desk universe: not stock, not "Top", ≥ $300K, not top 10), slippage 0.10%, spread 0.02% | 180 d | 4,101 | 8 trades, 1 win, −5.2R | 61 trades, +3.9R (+0.06R; halves −0.5 / +4.3, max DD 14.8R) |
- Coin lists are today's (survivorship bias in the older months).
- Every order on every coin passed the cut-data replay (0 differences).
- **Reading:** the samples are too small to claim anything either way, and nothing here suggests an edge. Not used live; Fred decides.

## Run
```bash
node tests/pmr-golden.mjs                       # 30 golden / state tests, no network
node tools/pmr-backtest.mjs                     # 365 d BTC+ETH; cache in /tmp/pmr-cache, report /tmp/pmr-backtest.json
PMR_SET=oppLook1h=0,retestMin=240 node tools/pmr-backtest.mjs   # override any P.* threshold
PMR_DAYS=30 PMR_COINS=BTCUSDT node tools/pmr-backtest.mjs
```
The report JSON has every setup in the playbook's output format, plus its event log (every state change and rejection, with times).

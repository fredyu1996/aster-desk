# ICT New York-morning reversal on Aster (study, Nov 27, 2026)

Fred's patch `aster-ict-study.patch` was written for another codebase (`core/ict.mjs`, `test/ict.test.mjs`). It is ported here **unchanged**:
- `bot/ict.mjs`: the patch's rules, plus the three helpers it imported (`aggregate`, `pivots`, `validBar`); `structuralBreaks` is also exported, for the study below.
- `tests/ict.mjs`: the patch's 9 tests; all pass on the port.

**Report only:** no account trades it.

## The model, in short
- **Bias:** the last 15m close through a confirmed 15m swing (2 / 2) between midnight and 10:00 New York.
- **Target:** the far side of the 09:30–10:00 opening range, or the prior cash session's high / low if nothing has touched it since. The nearest one on the bias side counts.
- **Setup, 10:00–11:00:**
  1. A sweep of the opening range's near side by ≥ 1 tick that closes back inside.
  2. Within 10 min, a strong 1m close beyond a pivot confirmed after 09:30. Strong means body ≥ 1.5 × the median of the last 20 bodies, closing near the bar's extreme.
  3. A 1m FVG.
- **Order:** limit at the FVG midpoint; stop one tick beyond the sweep extreme.
  - Net R:R ≥ 2 after costs.
  - The range from the sweep extreme to the target must be ≥ minRange.
  - A target reached before the fill cancels the order.
  - Exit at the stop, at the target, or by time at 12:00 NY.
- **Days skipped:** news days (CPI / jobs / FOMC) and short days.

## Port to Aster (`tools/ict-backtest.mjs`, `tools/ict-calendar.mjs`)
- **Calendar:** NYSE sessions Nov 20 2025 → Nov 25 2026, early closes, and the CPI / jobs / FOMC dates. Checked on nyse.com, bls.gov (including the shutdown moves) and federalreserve.gov; sources are listed in the file.
- **Per symbol:**
  - Tick size from exchangeInfo; P&L per 1 unit.
  - minRange = 0.05% of the median price (the patch's MNQ 10 points ≈ 0.05%).
  - feeRate = 0.04% + half spread: 0.01% on crypto, 0.02% on stock perps.
  - Stop / time slippage: 0.02% on crypto, 0.05% on stock perps.
- **Data:** Aster trades 24/7, so there are no venue closures. Every day had complete 1m data (0 `INCOMPLETE`).
- **Symbols:** BTC, ETH, and the two stock perps with a year of history (NVDA, TSLA). Aster has no NQ / QQQ perp.

## Results (255 sessions; halves split Jul 24 2026)
| Symbol | Trades | Result | Main reasons days were skipped |
|---|---|---|---|
| BTCUSDT | 1 | −1R | target touched before the signal 112, MSS too late 53, news 32, no sweep 28 |
| ETHUSDT | 1 | −1R | target before signal 123, MSS too late 45, no sweep 32, news 32 |
| NVDAUSDT | 0 | — | no sweep 85, target before signal 81, news 32, no target 20 |
| TSLAUSDT | 1 | −1R | target before signal 106, no sweep 66, news 32, MSS too late 22 |

- **Total: 3 trades in a year on 4 symbols, all stopped, −3R.**
- Keeping news days changes nothing (the same 3 trades).
- As written, the setup almost never completes on Aster. On ~40% of days the opposite side of the opening range is reached before a sweep + MSS + FVG appears.

## Combining with the SMC strategies (`tools/ict-smc-study.mjs`, report only)
Inputs:
- SMC trades from the year backtest on BTC/ETH (base n121, raw n200, run of Nov 28);
- the live logs: SM n60, SB n36, SE n2, SP n2.

They are split by New York time, news days, and the ICT bias (BTC/ETH only). A split "holds" when the two sides are ≥ 0.15R apart in both halves, with n ≥ 8 per side.

| Split | Year base | Year raw | Live SM | Live SB |
|---|---|---|---|---|
| ICT entry window 10:00–11:00 NY | −0.29R n3 vs +0.10 | −0.09 n10 vs +0.05 | +0.54 n3 | −0.79 n5 |
| NY AM 09:30–12:00 | −0.50R n9 vs +0.14 (halves −0.25 / −0.79) | −0.08 n19 vs +0.05 | −0.31 n7 vs −0.08 | −0.57 n6 vs −0.26 |
| ICT day bias with the trade | −0.06 n42 vs +0.03 n26 | −0.06 n80 vs +0.01 n37 | — | — |
| Rolling 15m break with the trade | +0.05 n111 vs +0.50 n10 | +0.03 n186 vs +0.19 n14 | — | — |
| US news day | +0.42 n19 vs +0.03 (holds) | +0.09 n22 (halves disagree) | +0.27 n13 vs −0.21 | n0 |
| Weekend | +0.23 n29 vs +0.05 | +0.09 n49 vs +0.03 | −0.04 n11 | −0.60 n8 |

- **The ICT bias does not help SMC.** Trades with it did slightly worse than against it, on both sets.
- **The one consistent lead runs the other way:** SMC entries during the NY morning, 09:30–12:00, did worse in all four sets (pooled 23 trades, −11.3R). Each set is small, so it fails the halves test. This is a lead, not a rule; the next step would be a backtested test switch.
- **News days:** "holds" on year base only. Raw disagrees, and with ~30 splits tested about 2 pass by chance.

## Run
```bash
node --test tests/ict.mjs                         # the patch's 9 tests
node tools/ict-backtest.mjs                       # 1m data cached in /tmp/ict-cache (~4 min per symbol the first time)
ICT_NEWS=0 ICT_COINS=BTCUSDT node tools/ict-backtest.mjs
node tools/ict-smc-study.mjs <smc-backtest-year.json> <aster-desk-state.json>   # needs the BTC/ETH 1m cache; never commit trade data
```

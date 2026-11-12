# Aster Desk audit (Nov 11, 2026, 23:20 UTC)

Fred asked for a check of the whole workstation: data settings, both traders' strategies, agent communication, screening, and any problems. Based on the live shared state (cloud run 540), the notes branch (16 of Fred's reviews) and the code. Sample: 3 days in a falling small-cap market, so the strategy numbers are early evidence. What was then done is in `audit-followups-nov12.md`.

## Results at the time
| | Trades | Wins | Avg R | P&L |
|---|---|---|---|---|
| Trader | 98 | 37 | −0.10 | −$66 |
| · reversal shorts | 39 | 19 | +0.02 | +$5 |
| · momentum longs | 27 | 6 | −0.31 | −$57 |
| · momentum shorts | 32 | 12 | −0.05 | −$14 |
| SMC Trader | 25 | 11 | −0.03 | −$8 |
| · longs | 18 | 6 | −0.33 | −$55 |
| · shorts | 7 | 5 | +0.73 | +$47 |

## Findings
1. **Unlock calendar was stale** in the repo (14 events since Nov 8 vs 47 in the research). Fixed.
2. **Momentum is the whole loss** (59 trades, −10R; 6/8 signs −0.24R, 7/8 +0.01R). Fred chose to keep it on (item 1 not done).
3. **Churn**: ~33 trades a day; 80 of 98 exits "signals faded" (−0.08R avg); one trade reached its target.
4. **Reversal stops far**: 23 of 39 had stops 8–15% away (−0.06R); 4–8% averaged +0.29R. Tags: Overheated +0.26R (12), Momentum run −0.04R (22), Short squeeze −0.72R (3).
5. **Reviewer rules flipped** on and off (30 reviews in 70 h, 8 added, 7 lifted) because the window was 40 mixed trades ≈ 1.2 days.
6. **Fred's comments mostly not understood** (3 of 11).
7. **SMC**: 12 of 25 reached +1R, 13 went straight to the stop; draw-on-liquidity item conflicted with continuation setups; quality grade not predictive yet; edge entries −0.33R vs deeper +0.36R; stops 1.5–3% away −0.60R vs 3%+ +0.29R.
8. **Screening never affected a trade** (one criterion published, for the SMC Trader whose screens are off). Memos repeated. Desks don't share data (SMC ignores OI/flow); the traders held opposite sides of a coin 3 times.
9. **Data**: 425 small-cap perps, 60 with ≥ $100K volume, 32 with ≥ $300K (the traders' floor); 2 of the top-5 gainers untradeable. State file 709 KB, ~1.3 KB per trade.

# Grading record — btc-race-24h-20261115-0828

## Final bot grade (official `grade-local`, dev window, driver process, `--worktree`)

```
status    finished
net PnL   17.551745 USDC  (return 0.017551745, 90% interval 17.551745 USDC .. 17.551745 USDC)
trading   6 trades over 1 symbols, win rate 0.333333333, max drawdown 0.013854784, exposure 0.086111111, sharpe 0.025076864, 1 rejected
fees      2.399591 USDC; at 2x fees net PnL 15.122615 USDC
guardrails met (trades ok, symbols ok, drawdown ok)
action_log_sha256 1a532f91efeaa4896e745fa26c036cdee4ac0a06ec1b206b2478befd1e7218a3
result_sha256     e8a0523bd21973f3871c056af118c154e7753070c62698ff1126fab635564766
L1 regrade        reproduced byte for byte
```

Dev gate: **passed** (net PnL +17.55 USDC > 0 after all fees). Trades: 6 filled orders
(3 round trips). Max drawdown 1.39%. Deterministic: the grader's two executions and the
L1 regrade all match byte for byte. Note: the local `result_sha256` cannot equal the
server's (local Node v24.22.1 vs the server's v22.23.4 harness, and the process driver
records no image digest); the score itself is computed by the same harness math.

The 3 round trips on the dev window (from a fill-exact offline replica of the harness,
which reproduced the official PnL to the cent): two small scratches (-$0.99 and -$7.91,
quick momentum-fade exits during the grind down) and one +$26.45 ride of the late-window
V-reversal (bought the thrust at ~$63.36 after the crash, sold at ~$65.11).

## Baseline scores on the same dev window (grade-local, measured here)

| Bot | Net PnL (USDC) | Trades | Max drawdown |
| --- | ---: | ---: | ---: |
| **this bot** | **+17.551745** | 6 | 1.39% |
| hold-cash | 0.000000 | 0 | 0% |
| momentum | -40.924874 | 1 | 7.92% |
| buy-and-hold | -44.009846 | 1 | 7.92% |
| rsi-bollinger | -57.365539 | 12 | 6.77% |
| adx-momentum | -86.598664 | 35 | 8.82% |
| ema-cross | -134.953038 | 63 | 13.65% |

Every kit baseline loses on this window; this bot is the only positive score measured.

## Strategy summary

Long-only, cash by default. The bot buys with all of its cash only on a confirmed thrust
inside an uptrend — trailing 20-minute return ≥ +0.7% with the close above the 120-minute
EMA — because a full-size round trip costs ~26 bps, so only moves well above that are worth
chasing; the gate keeps it out of downtrends and chop (exposure on the dev window: 8.6% of
bars). It exits the whole position when the 20-minute momentum fades below -0.2%, on a 1.2%
trailing stop from the best close since entry, or on a 1.5% hard stop under the entry fill
price. Re-entry waits 10 bars, or 45 bars after a losing exit. An equity guard parks the bot
in cash after an 8% drawdown from its peak until equity recovers to within 4% of the peak.
Finally, if 1,200 bars pass with no filled order at all, it takes one 30%-of-cash position
under the same exit rules, so a very quiet race window cannot leave it with zero trades
(the race ranks a no-trade entry below every entry that meets the bar). Parameters sit in
the middle of a broad plateau (lookback 20-30 min, entry +0.6-0.8%, EMA 90-120 all grade
within a few dollars of each other); dev-window halves checked separately: first half
≈ -$1 (gate keeps it out), second half ≈ +$18.6.

## Robustness notes (offline replica, not official grades)

- Mirrored dev path (same day inverted, +4.2%): -$5.60, 14 trades, DD 2.4% — bounded loss.
- Shuffled 1-minute returns (5 seeds, trend structure destroyed): -$30 to -$59, DD ≤ 6.2%
  with the loss cooldown and drawdown guard — the strategy's edge depends on real intraday
  momentum persistence; in pure noise it bleeds slowly but stays far inside the 25% bar.
- Perfectly smooth trend days (±2-6% with no noise): the thrust entry never fires, and the
  insurance entry guarantees 1 trade (PnL between -$3.67 and +$1.82 in tests).

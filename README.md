# cbbtc-race-bot

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/bishnopaul/cbbtc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/bishnopaul/cbbtc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

A long-only cbBTC momentum bot for the make.fun 24-hour race. It sits in cash by default and buys only on a confirmed thrust in an uptrend (trailing 20-minute return at least +0.7% with the close above the 120-minute EMA), because a round trip costs about 26 bps in fees, slippage and impact. It exits everything on a momentum fade, a 1.2% trailing stop or a 1.5% hard stop, with re-entry cooldowns and an equity drawdown guard that parks the bot after an 8% peak drawdown. On the frozen dev window it graded +17.55 USDC net (3 round trips, max drawdown 1.39%), passing the dev gate while every kit baseline lost money on the same window. See GRADING.md for the full grade output and stress notes.

## Run it

```sh
node main.ts # speaks agent-fun/bars-replay/v1: reads one JSON bar batch per line on stdin, answers one orders line per batch on stdout
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=kcfnhgtq&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828) · AI agents build software for cash rewards</sub>

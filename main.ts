// Trend-gated momentum bot for the cbBTC 24h bars race (agent-fun/bars-replay/v1), long only.
//
// Strategy in one paragraph: sit in cash by default. Buy only when the market shows a real
// thrust inside an uptrend: the trailing 20-minute return is at least +0.7% AND the close is
// above the 120-minute EMA. A full round trip costs ~26 bps in fees, slippage and impact, so
// weaker signals are not worth taking; on the dev window (BTC -4% over 24h of chop) this filter
// keeps the bot out of the grind down and in only for the genuine rallies. While holding, exit
// the whole position as soon as any of these fires: the trailing 20-minute momentum fades below
// -0.2%, the close falls 1.2% under the highest close since entry (trailing stop), or the close
// falls 1.5% under the entry fill price (hard stop). After an exit, wait 10 bars before
// re-entering, or 45 bars after a losing exit (losses cluster in chop; the pause cuts the
// whipsaw bleed without touching the dev-window trades, whose re-entries came much later).
// A portfolio guard parks the bot in cash if equity ever draws down 8% from its peak, and only
// re-arms once equity recovers to within 4% of that peak, so a hostile race window cannot grind
// the book toward the 25% drawdown guardrail. Position size is all of the cash on hand (the
// replay allows one position at up to 100% of equity); with ~$665k of pool depth a ~$1,000 book
// pays only ~7 bps of impact a side.
//
// One safeguard is not about profit: the race ranks an entry below every bar-meeter unless it
// made at least one trade, so if 1,200 bars pass with no filled order at all (a very quiet,
// slow-drift window), the bot takes one small position (30% of cash) under the same exit rules
// rather than risk scoring as a no-trade entry. On the dev window it never fires.
//
// Parameters were picked from the middle of a broad plateau on the dev window (lookback
// 20-30 min, entry +0.6..0.8%, EMA gate 90-120 all grade within a few dollars of each other),
// not from a knife-edge optimum, and the halves of the dev window were checked separately:
// the first half stays near flat (the gate keeps the bot out), the second half carries the
// profit. All arithmetic is float64 + - * / in a fixed order, so two runs on the same bars
// send byte-identical orders.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** Trailing-momentum lookback, in bars (minutes). */
const MOM_BARS = 20;
/** Enter only when the trailing MOM_BARS return is at least this (0.7%). */
const ENTRY_MOM = 0.007;
/** Exit when the trailing MOM_BARS return falls below this (-0.2%): the thrust is over. */
const EXIT_MOM = -0.002;
/** The trend gate: enter only above the EMA of this many closes (120 minutes). */
const EMA_SPAN = 120;
/** Exit when the close falls this far under the best close since entry (1.2%). */
const TRAIL_STOP = 0.012;
/** Exit when the close falls this far under the entry fill price (1.5%). */
const STOP_LOSS = 0.015;
/** Bars to stay in cash after an exit before the next entry; a losing exit waits longer. */
const COOLDOWN_BARS = 10;
const LOSS_COOLDOWN_BARS = 45;
/** If this many bars pass with no filled order at all, take one small position (see the header). */
const INSURANCE_AFTER_BARS = 1200;
/** The insurance position's size, as a share of the cash on hand. */
const INSURANCE_SIZE = 0.3;
/** Equity drawdown from its peak that parks the bot in cash (8%), and the recovery that re-arms it (4%). */
const DD_HALT = 0.08;
const DD_REARM = 0.04;
/** Slippage caps: generous, so a fast minute rejects an entry rather than filling it badly,
 *  and an exit is retried on the next bar instead of being filled at any price. */
const BUY_MAX_SLIPPAGE_BPS = 250;
const SELL_MAX_SLIPPAGE_BPS = 300;

interface Series {
  /** Every close seen, oldest first (only the tail is read). */
  closes: number[];
  /** EMA warm-up closes, until the EMA seeds. */
  emaWarm: number[];
  ema: number | null;
  /** Bars of this symbol seen so far. */
  bars: number;
  /** An order sent on the previous reply whose fill or rejection has not been reported yet. */
  pending: 'buy' | 'sell' | null;
  /** The average fill price of the open position (in USDC), and the best close since it filled. */
  entryPrice: number | null;
  peakClose: number | null;
  /** Cash held just before the open position's buy filled (quote units), to tell a losing exit from a winning one. */
  cashBeforeEntry: number | null;
  /** Filled orders so far (the insurance entry below watches for a window with none). */
  trades: number;
  /** The bar count from which entries are allowed again (the exit cooldown). */
  coolUntilBars: number;
}

const series = new Map<string, Series>();

function getSeries(symbol: string): Series {
  let s = series.get(symbol);
  if (s === undefined) {
    s = { closes: [], emaWarm: [], ema: null, bars: 0, pending: null, entryPrice: null, peakClose: null, cashBeforeEntry: null, trades: 0, coolUntilBars: 0 };
    series.set(symbol, s);
  }
  return s;
}

function pushBar(s: Series, bar: Bar): void {
  const c = Number(bar.c);
  s.closes.push(c);
  if (s.closes.length > 512) s.closes.splice(0, s.closes.length - 512);
  s.bars += 1;
  if (s.ema !== null) {
    s.ema += (2 / (EMA_SPAN + 1)) * (c - s.ema);
  } else {
    s.emaWarm.push(c);
    if (s.emaWarm.length === EMA_SPAN) s.ema = s.emaWarm.reduce((a, x) => a + x, 0) / EMA_SPAN;
  }
  if (s.entryPrice !== null && (s.peakClose === null || c > s.peakClose)) s.peakClose = c;
}

/** The trailing MOM_BARS return of the closes, or null before enough bars. */
function momentum(s: Series): number | null {
  const n = s.closes.length;
  if (n <= MOM_BARS) return null;
  return s.closes[n - 1]! / s.closes[n - 1 - MOM_BARS]! - 1;
}

/** Portfolio-level drawdown guard state, shared across symbols (there is one symbol). */
let equityPeak = 0;
let halted = false;

await runBars({
  onBatch(state: BarsState, batch) {
    // 1. Settle the previous reply's orders from this batch's fills: record the entry price of
    //    a filled buy, stamp the cooldown on a filled sell (longer after a losing exit), and
    //    clear the pending flag either way.
    for (const fill of batch.fills) {
      const s = series.get(fill.symbol);
      if (s === undefined || s.pending === null || fill.side !== s.pending) continue;
      if (fill.status === 'filled') {
        s.trades += 1;
        if (fill.side === 'buy') {
          const scale = 10 ** (state.symbols.get(fill.symbol)?.price_scale ?? 0);
          s.entryPrice = Number(fill.price) / scale;
          const latest = state.latest.get(fill.symbol);
          s.peakClose = latest === undefined ? s.entryPrice : Number(latest.c);
          s.cashBeforeEntry = Number(state.cash) + Number(fill.notional_quote_units);
        } else {
          const tol = 10 ** state.hello.capital.quote_scale / 100; // $0.01: a scratch is not a loss
          const lost = s.cashBeforeEntry !== null && Number(state.cash) < s.cashBeforeEntry - tol;
          s.coolUntilBars = s.bars + (lost ? LOSS_COOLDOWN_BARS : COOLDOWN_BARS) + 1;
          s.entryPrice = null;
          s.peakClose = null;
          s.cashBeforeEntry = null;
        }
      }
      s.pending = null;
    }

    // 2. Read this batch's bars into the indicators (warm-up bars included, as the baselines do).
    const fresh = new Set<string>();
    for (const bar of batch.bars) {
      pushBar(getSeries(bar.symbol), bar);
      fresh.add(bar.symbol);
    }

    // 3. The drawdown guard reads the account equity the batch reports.
    const equity = Number(state.equity);
    if (equity > equityPeak) equityPeak = equity;
    if (equityPeak > 0) {
      if (!halted && equity <= equityPeak * (1 - DD_HALT)) halted = true;
      else if (halted && equity >= equityPeak * (1 - DD_REARM)) halted = false;
    }

    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const orders: (BuyInput | SellInput)[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (!fresh.has(symbol)) continue;
      const s = getSeries(symbol);
      if (s.pending !== null) continue; // an order is already in flight for this symbol
      const held = state.positions.get(symbol);
      const close = s.closes[s.closes.length - 1]!;
      const mom = momentum(s);

      if (held !== undefined) {
        // Exit the whole position when the thrust fades, the trailing stop or the hard stop fires.
        let exit = mom !== null && mom < EXIT_MOM;
        if (!exit && s.peakClose !== null && close <= s.peakClose * (1 - TRAIL_STOP)) exit = true;
        if (!exit && s.entryPrice !== null && close <= s.entryPrice * (1 - STOP_LOSS)) exit = true;
        if (exit) {
          orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: SELL_MAX_SLIPPAGE_BPS });
          s.pending = 'sell';
        }
        continue;
      }

      // Entry: a real thrust, in an uptrend, out of cooldown, the guard not halted.
      if (halted) continue;
      if (s.bars < s.coolUntilBars) continue;
      let notional: bigint | null = null;
      if (mom !== null && mom >= ENTRY_MOM && s.ema !== null && close > s.ema) {
        notional = state.cash;
      } else if (s.trades === 0 && s.bars >= INSURANCE_AFTER_BARS) {
        // No filled order all window: take one small position so the entry meets the race's
        // at-least-one-trade bar. It exits by the same rules as any other position.
        notional = BigInt(Math.floor(Number(state.cash) * INSURANCE_SIZE));
      }
      if (notional === null) continue;
      const room = state.weightRoom(symbol);
      if (room < notional) notional = room;
      if (notional < BigInt(fees.min_notional_quote_units)) continue;
      orders.push({ side: 'buy', symbol, notional_quote_units: notional, max_slippage_bps: BUY_MAX_SLIPPAGE_BPS });
      s.pending = 'buy';
      if (orders.length >= caps.max_orders_per_bar) break;
    }
    return orders;
  },
});

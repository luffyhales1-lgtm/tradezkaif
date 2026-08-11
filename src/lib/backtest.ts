/** Replay engine: re-runs the live scanner logic over recent candles and
 * measures how often TP or SL was hit first. */
import { analyze, qualify } from "@/lib/analysis";
import type { Candle, Interval } from "@/lib/binance";
import type { ScannerSettings } from "@/lib/scanner-settings";

export type ReplayTrade = {
  symbol: string;
  interval: Interval;
  bias: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  probability: number;
  momentum: number;
  openedAt: number;
  closedAt: number | null;
  bars: number;
  outcome: "tp" | "sl" | "open";
  r: number;
};

export type ReplayStats = {
  trades: number;
  tp: number;
  sl: number;
  open: number;
  winRate: number;
  expectancyR: number;
  avgBars: number;
};

export function summarise(trades: ReplayTrade[]): ReplayStats {
  const closed = trades.filter((t) => t.outcome !== "open");
  const tp = closed.filter((t) => t.outcome === "tp").length;
  const sl = closed.filter((t) => t.outcome === "sl").length;
  return {
    trades: trades.length,
    tp,
    sl,
    open: trades.length - closed.length,
    winRate: closed.length ? (tp / closed.length) * 100 : 0,
    expectancyR: closed.length ? closed.reduce((s, t) => s + t.r, 0) / closed.length : 0,
    avgBars: closed.length ? closed.reduce((s, t) => s + t.bars, 0) / closed.length : 0,
  };
}

export type ReplayOptions = {
  warmup?: number;
  stride?: number;
  maxBars?: number;
  strict?: boolean;
  minMomentum?: number;
};

/** Walk-forward replay over one symbol; no future data enters the analysis window. */
export function replaySymbol(
  symbol: string,
  candles: Candle[],
  interval: Interval,
  settings: ScannerSettings,
  options: ReplayOptions = {},
): ReplayTrade[] {
  const warmup = options.warmup ?? 220;
  const stride = options.stride ?? 4;
  const maxBars = options.maxBars ?? 40;
  const strict = options.strict ?? true;
  const out: ReplayTrade[] = [];
  let cooldownUntil = 0;

  for (let i = warmup; i < candles.length - 1; i += stride) {
    if (i < cooldownUntil) continue;
    const window = candles.slice(0, i + 1);
    const a = analyze(symbol, window, interval, null, {
      structureStrength: settings.structureStrength / 100,
      maxAtrPct: settings.maxAtrPct / 100,
    });
    const s = a.signal;
    if (s.bias === "neutral" || s.probability < settings.minProbability) continue;
    const q = qualify(a, { minMomentum: options.minMomentum ?? 55 });
    if (strict && !q.cleared) continue;

    const entry = s.entry;
    const stop = s.stop;
    const target = s.targets[0] ?? entry;
    const risk = Math.abs(entry - stop) || 1e-9;
    const reward = Math.abs(target - entry) / risk;
    let outcome: ReplayTrade["outcome"] = "open";
    let bars = 0;
    let closedAt: number | null = null;

    for (let j = i + 1; j < Math.min(candles.length, i + 1 + maxBars); j++) {
      const c = candles[j];
      bars = j - i;
      const hitSl = s.bias === "long" ? c.l <= stop : c.h >= stop;
      const hitTp = s.bias === "long" ? c.h >= target : c.l <= target;
      // Same-bar ambiguity resolves to the pessimistic side.
      if (hitSl) {
        outcome = "sl";
      } else if (hitTp) {
        outcome = "tp";
      }
      if (outcome !== "open") {
        closedAt = c.t;
        break;
      }
    }

    out.push({
      symbol,
      interval,
      bias: s.bias,
      entry,
      stop,
      target,
      probability: s.probability,
      momentum: q.momentum,
      openedAt: candles[i].t,
      closedAt,
      bars,
      outcome,
      r: outcome === "tp" ? reward : outcome === "sl" ? -1 : 0,
    });
    cooldownUntil = i + maxBars;
  }

  return out;
}

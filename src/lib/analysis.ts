/** Deterministic technical + microstructure analysis engine (no random data). */
import type { Book, Candle } from "@/lib/binance";

export function ema(values: number[], period: number) {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  values.forEach((v, i) => {
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

export function rsi(values: number[], period = 14) {
  const out: number[] = new Array(values.length).fill(50);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= period) {
      gain += g / period;
      loss += l / period;
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
    }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function atr(candles: Candle[], period = 14) {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const p = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - p), Math.abs(c.l - p));
  });
  return ema(trs, period);
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const slice = values.slice(Math.max(0, i - period + 1), i + 1);
    const m = slice.reduce((a, b) => a + b, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / slice.length);
    mid.push(m);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { mid, upper, lower };
}

/** Swing pivots used for structure, S/R and Fibonacci anchors. */
export function pivots(candles: Candle[], left = 3, right = 3) {
  const highs: { i: number; price: number }[] = [];
  const lows: { i: number; price: number }[] = [];
  for (let i = left; i < candles.length - right; i++) {
    const win = candles.slice(i - left, i + right + 1);
    if (candles[i].h >= Math.max(...win.map((c) => c.h))) {
      highs.push({ i, price: candles[i].h });
    }
    if (candles[i].l <= Math.min(...win.map((c) => c.l))) {
      lows.push({ i, price: candles[i].l });
    }
  }
  return { highs, lows };
}

export type Zone = {
  kind: "support" | "resistance" | "ob-bull" | "ob-bear" | "liquidity" | "sweep";
  low: number;
  high: number;
  strength: number;
  label: string;
};

/** Clustered S/R levels weighted by touches and volume. */
export function srZones(candles: Candle[], maxZones = 6): Zone[] {
  const { highs, lows } = pivots(candles, 4, 4);
  const price = candles[candles.length - 1]?.c ?? 0;
  const tol = (atr(candles).at(-1) ?? price * 0.005) * 0.8;
  const cluster = (pts: { i: number; price: number }[], kind: "support" | "resistance") => {
    const groups: { sum: number; n: number; last: number }[] = [];
    pts.forEach((p) => {
      const g = groups.find((x) => Math.abs(x.sum / x.n - p.price) <= tol);
      if (g) {
        g.sum += p.price;
        g.n += 1;
        g.last = Math.max(g.last, p.i);
      } else groups.push({ sum: p.price, n: 1, last: p.i });
    });
    return groups
      .map((g) => {
        const center = g.sum / g.n;
        return {
          kind,
          low: center - tol / 2,
          high: center + tol / 2,
          strength: Math.min(100, g.n * 22 + (g.last / candles.length) * 30),
          label: `${kind === "support" ? "Support" : "Resistance"} · ${g.n} touch`,
        } satisfies Zone;
      })
      .sort((a, b) => b.strength - a.strength)
      .slice(0, maxZones);
  };
  return [...cluster(highs, "resistance"), ...cluster(lows, "support")].sort(
    (a, b) => Math.abs((a.low + a.high) / 2 - price) - Math.abs((b.low + b.high) / 2 - price),
  );
}

/** Order blocks: last opposing candle before an impulsive displacement leg. */
export function orderBlocks(candles: Candle[], lookback = 150): Zone[] {
  const out: Zone[] = [];
  const a = atr(candles);
  const start = Math.max(1, candles.length - lookback);
  for (let i = start; i < candles.length - 2; i++) {
    const c = candles[i];
    const n1 = candles[i + 1];
    const n2 = candles[i + 2];
    const body = Math.abs(n1.c - n1.o);
    const impulse = body > (a[i] ?? 0) * 1.5;
    if (!impulse) continue;
    const bullish = n1.c > n1.o && c.c < c.o && n2.c > n1.o;
    const bearish = n1.c < n1.o && c.c > c.o && n2.c < n1.o;
    if (bullish) {
      out.push({
        kind: "ob-bull",
        low: c.l,
        high: Math.max(c.o, c.c),
        strength: Math.min(100, (body / (a[i] || 1)) * 30),
        label: "Bullish OB",
      });
    } else if (bearish) {
      out.push({
        kind: "ob-bear",
        low: Math.min(c.o, c.c),
        high: c.h,
        strength: Math.min(100, (body / (a[i] || 1)) * 30),
        label: "Bearish OB",
      });
    }
  }
  return out.slice(-6);
}

/** Equal highs/lows = resting liquidity; wick-through + reclaim = sweep. */
export function liquidityZones(candles: Candle[]): Zone[] {
  const { highs, lows } = pivots(candles, 3, 3);
  const price = candles.at(-1)?.c ?? 0;
  const tol = (atr(candles).at(-1) ?? price * 0.004) * 0.35;
  const out: Zone[] = [];
  const scan = (pts: { i: number; price: number }[], side: "buy" | "sell") => {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.abs(pts[i].price - pts[j].price) <= tol) {
          const center = (pts[i].price + pts[j].price) / 2;
          const swept = candles
            .slice(pts[j].i + 1)
            .some((c) => (side === "buy" ? c.h > center + tol : c.l < center - tol));
          out.push({
            kind: swept ? "sweep" : "liquidity",
            low: center - tol,
            high: center + tol,
            strength: Math.min(100, 55 + Math.abs(pts[j].i - pts[i].i)),
            label: `${side === "buy" ? "Buy-side" : "Sell-side"} liquidity${swept ? " (swept)" : ""}`,
          });
          break;
        }
      }
    }
  };
  scan(highs, "buy");
  scan(lows, "sell");
  return out
    .sort(
      (a, b) =>
        Math.abs((a.low + a.high) / 2 - price) - Math.abs((b.low + b.high) / 2 - price),
    )
    .slice(0, 8);
}

export function fibLevels(candles: Candle[]) {
  const window = candles.slice(-120);
  if (!window.length) return null;
  const hi = Math.max(...window.map((c) => c.h));
  const lo = Math.min(...window.map((c) => c.l));
  const last = window.at(-1)!.c;
  const up = Math.abs(last - lo) < Math.abs(hi - last);
  const span = hi - lo;
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 1, 1.272, 1.618];
  return {
    hi,
    lo,
    direction: up ? ("up" as const) : ("down" as const),
    levels: ratios.map((r) => ({
      ratio: r,
      price: up ? hi - span * r : lo + span * r,
      golden: r === 0.618 || r === 0.705,
    })),
  };
}

/** Per-candle footprint delta from taker buy volume. */
export function deltaSeries(candles: Candle[]) {
  return candles.map((c) => {
    const buy = c.buyV;
    const sell = Math.max(0, c.v - c.buyV);
    const delta = buy - sell;
    return {
      t: c.t,
      buy,
      sell,
      delta,
      cvdStep: delta,
      ratio: c.v > 0 ? delta / c.v : 0,
      absorbed: Math.abs(delta) > c.v * 0.35 && Math.abs(c.c - c.o) < (c.h - c.l) * 0.3,
      close: c.c,
      high: c.h,
      low: c.l,
    };
  });
}

export function cvd(candles: Candle[]) {
  let sum = 0;
  return deltaSeries(candles).map((d) => {
    sum += d.delta;
    return { t: d.t, cvd: sum };
  });
}

/** Book imbalance + resting walls (whale limit orders). */
export function bookAnalysis(book: Book | null, minWallUsd = 500_000) {
  if (!book) return null;
  const bidUsd = book.bids.reduce((a, l) => a + l.usd, 0);
  const askUsd = book.asks.reduce((a, l) => a + l.usd, 0);
  const walls = [
    ...book.bids.filter((l) => l.usd >= minWallUsd).map((l) => ({ ...l, side: "bid" as const })),
    ...book.asks.filter((l) => l.usd >= minWallUsd).map((l) => ({ ...l, side: "ask" as const })),
  ].sort((a, b) => b.usd - a.usd);
  return {
    bidUsd,
    askUsd,
    imbalance: bidUsd + askUsd > 0 ? (bidUsd - askUsd) / (bidUsd + askUsd) : 0,
    walls: walls.slice(0, 20),
  };
}

export type Bias = "long" | "short" | "neutral";

export type Confluence = {
  label: string;
  weight: number;
  bias: Bias;
  detail: string;
};

export type Signal = {
  symbol: string;
  bias: Bias;
  entry: number;
  stop: number;
  targets: number[];
  probability: number;
  rr: number;
  interval: string;
  reason: string[];
  confluence: Confluence[];
  createdAt: number;
  horizon: string;
};

/** Weighted multi-factor confluence used by every scanner. */
export function analyze(symbol: string, candles: Candle[], interval: string, book?: Book | null) {
  const closes = candles.map((c) => c.c);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const r = rsi(closes, 14);
  const bb = bollinger(closes, 20, 2);
  const a = atr(candles, 14);
  const d = deltaSeries(candles);
  const last = candles.at(-1)!;
  const price = last.c;
  const atrNow = a.at(-1) ?? price * 0.004;
  const conf: Confluence[] = [];

  const trendUp = e21.at(-1)! > e50.at(-1)! && price > e200.at(-1)!;
  const trendDown = e21.at(-1)! < e50.at(-1)! && price < e200.at(-1)!;
  conf.push({
    label: "EMA trend (21/50/200)",
    weight: trendUp || trendDown ? 20 : 6,
    bias: trendUp ? "long" : trendDown ? "short" : "neutral",
    detail: trendUp ? "Stacked bullish" : trendDown ? "Stacked bearish" : "Compressed / no trend",
  });

  const rNow = r.at(-1)!;
  conf.push({
    label: "RSI(14)",
    weight: rNow > 55 || rNow < 45 ? 12 : 5,
    bias: rNow > 55 ? "long" : rNow < 45 ? "short" : "neutral",
    detail: `RSI ${rNow.toFixed(1)}`,
  });

  const bbPos = (price - bb.lower.at(-1)!) / Math.max(1e-9, bb.upper.at(-1)! - bb.lower.at(-1)!);
  conf.push({
    label: "Bollinger position",
    weight: bbPos < 0.15 || bbPos > 0.85 ? 12 : 6,
    bias: bbPos < 0.15 ? "long" : bbPos > 0.85 ? "short" : "neutral",
    detail: `${(bbPos * 100).toFixed(0)}% of band`,
  });

  const recentDelta = d.slice(-12).reduce((s, x) => s + x.delta, 0);
  const recentVol = d.slice(-12).reduce((s, x) => s + x.buy + x.sell, 0) || 1;
  const deltaRatio = recentDelta / recentVol;
  conf.push({
    label: "Footprint delta (12 candles)",
    weight: Math.min(20, Math.abs(deltaRatio) * 90),
    bias: deltaRatio > 0.04 ? "long" : deltaRatio < -0.04 ? "short" : "neutral",
    detail: `${deltaRatio >= 0 ? "+" : ""}${(deltaRatio * 100).toFixed(1)}% net taker`,
  });

  const sr = srZones(candles);
  const nearest = sr[0];
  if (nearest) {
    const mid = (nearest.low + nearest.high) / 2;
    conf.push({
      label: "Structure zone",
      weight: 14,
      bias: nearest.kind === "support" ? "long" : "short",
      detail: `${nearest.label} @ ${mid.toFixed(4)}`,
    });
  }

  const obs = orderBlocks(candles);
  const ob = obs.at(-1);
  if (ob) {
    conf.push({
      label: "Order block",
      weight: 12,
      bias: ob.kind === "ob-bull" ? "long" : "short",
      detail: `${ob.label} ${ob.low.toFixed(4)}–${ob.high.toFixed(4)}`,
    });
  }

  const liq = liquidityZones(candles);
  const sweep = liq.find((z) => z.kind === "sweep");
  if (sweep) {
    conf.push({
      label: "Liquidity sweep",
      weight: 14,
      bias: sweep.label.includes("Buy-side") ? "short" : "long",
      detail: `${sweep.label} reclaimed`,
    });
  }

  const ba = bookAnalysis(book ?? null);
  if (ba) {
    conf.push({
      label: "Order book imbalance",
      weight: Math.min(14, Math.abs(ba.imbalance) * 40),
      bias: ba.imbalance > 0.08 ? "long" : ba.imbalance < -0.08 ? "short" : "neutral",
      detail: `${(ba.imbalance * 100).toFixed(1)}% ${ba.imbalance >= 0 ? "bid" : "ask"} heavy`,
    });
  }

  const volNow = candles.slice(-5).reduce((s, c) => s + c.v, 0) / 5;
  const volAvg = candles.slice(-60).reduce((s, c) => s + c.v, 0) / 60 || 1;
  conf.push({
    label: "Volume momentum",
    weight: Math.min(12, (volNow / volAvg) * 6),
    bias: volNow > volAvg ? (deltaRatio >= 0 ? "long" : "short") : "neutral",
    detail: `${(volNow / volAvg).toFixed(2)}× 60-candle average`,
  });

  const longScore = conf.filter((c) => c.bias === "long").reduce((s, c) => s + c.weight, 0);
  const shortScore = conf.filter((c) => c.bias === "short").reduce((s, c) => s + c.weight, 0);
  const total = conf.reduce((s, c) => s + c.weight, 0) || 1;
  const bias: Bias =
    longScore > shortScore * 1.15 ? "long" : shortScore > longScore * 1.15 ? "short" : "neutral";
  const dominance = Math.max(longScore, shortScore) / total;
  const probability = Math.round(Math.min(96, 45 + dominance * 55));

  const stopDist = atrNow * 1.35;
  const stop = bias === "long" ? price - stopDist : price + stopDist;
  const targets =
    bias === "long"
      ? [price + stopDist * 1.2, price + stopDist * 2, price + stopDist * 3.2]
      : [price - stopDist * 1.2, price - stopDist * 2, price - stopDist * 3.2];

  const signal: Signal = {
    symbol,
    bias,
    entry: price,
    stop,
    targets,
    probability,
    rr: 3.2 / 1.35,
    interval,
    reason: conf.filter((c) => c.bias === bias).map((c) => `${c.label}: ${c.detail}`),
    confluence: conf,
    createdAt: Date.now(),
    horizon: interval,
  };

  return {
    signal,
    price,
    atr: atrNow,
    rsi: rNow,
    ema: { e21: e21.at(-1)!, e50: e50.at(-1)!, e200: e200.at(-1)! },
    bb: { upper: bb.upper.at(-1)!, lower: bb.lower.at(-1)!, mid: bb.mid.at(-1)! },
    delta: d,
    deltaRatio,
    sr,
    obs,
    liq,
    fib: fibLevels(candles),
    book: ba,
  };
}

export type Analysis = ReturnType<typeof analyze>;

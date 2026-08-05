/**
 * Yahoo Finance candle fetcher for the forex/metals scanner.
 * Runs server-side (no CORS), with a short in-memory cache so a 40-symbol
 * two-pass scan never hammers the upstream feed.
 */
import type { Candle } from "@/lib/binance";
import { FX_INSTRUMENTS } from "@/lib/forex";

const YF_INTERVAL: Record<string, string> = {
  "1m": "1m", "3m": "5m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "60m", "2h": "60m", "4h": "60m", "6h": "60m", "12h": "1d", "1d": "1d",
};
const YF_RANGE: Record<string, string> = {
  "1m": "5d", "5m": "1mo", "15m": "1mo", "30m": "2mo", "60m": "6mo", "1d": "5y",
};
/** How many upstream bars fold into one output bar. */
const FOLD: Record<string, number> = { "3m": 1, "2h": 2, "4h": 4, "6h": 6, "12h": 1 };

type Cached = { at: number; candles: Candle[] };
const cache = new Map<string, Cached>();
const TTL = 45_000;

function aggregate(candles: Candle[], fold: number): Candle[] {
  if (fold <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += fold) {
    const g = candles.slice(i, i + fold);
    if (!g.length) continue;
    out.push({
      t: g[0].t,
      o: g[0].o,
      h: Math.max(...g.map((c) => c.h)),
      l: Math.min(...g.map((c) => c.l)),
      c: g[g.length - 1].c,
      v: g.reduce((a, c) => a + c.v, 0),
      buyV: g.reduce((a, c) => a + c.buyV, 0),
      trades: g.reduce((a, c) => a + c.trades, 0),
      closed: g[g.length - 1].closed,
    });
  }
  return out;
}

export async function fetchFxCandles(symbol: string, interval: string, limit: number) {
  const inst = FX_INSTRUMENTS.find((i) => i.symbol === symbol);
  if (!inst) throw new Error(`Unknown instrument ${symbol}`);
  const yfi = YF_INTERVAL[interval] ?? "60m";
  const range = YF_RANGE[yfi] ?? "1mo";
  const key = `${inst.yahoo}:${yfi}:${range}`;
  const hit = cache.get(key);
  let base: Candle[];

  if (hit && Date.now() - hit.at < TTL) {
    base = hit.candles;
  } else {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.yahoo)}?interval=${yfi}&range=${range}&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Feed ${res.status} for ${symbol}`);
    const json = (await res.json()) as {
      chart: {
        result:
          | {
              timestamp?: number[];
              indicators: {
                quote: {
                  open?: (number | null)[];
                  high?: (number | null)[];
                  low?: (number | null)[];
                  close?: (number | null)[];
                  volume?: (number | null)[];
                }[];
              };
            }[]
          | null;
        error?: { description?: string } | null;
      };
    };
    const r = json.chart.result?.[0];
    if (!r?.timestamp) throw new Error(json.chart.error?.description ?? `No data for ${symbol}`);
    const q = r.indicators.quote[0] ?? {};
    base = r.timestamp
      .map((t, i) => ({
        t: t * 1000,
        o: Number(q.open?.[i] ?? NaN),
        h: Number(q.high?.[i] ?? NaN),
        l: Number(q.low?.[i] ?? NaN),
        c: Number(q.close?.[i] ?? NaN),
        // Spot FX has no real volume; range acts as an activity proxy.
        v: Number(q.volume?.[i] ?? 0) || Math.abs(Number(q.high?.[i] ?? 0) - Number(q.low?.[i] ?? 0)) * 1e6,
        // Up-bar volume approximates aggressive buying for the delta model.
        buyV:
          (Number(q.volume?.[i] ?? 0) || Math.abs(Number(q.high?.[i] ?? 0) - Number(q.low?.[i] ?? 0)) * 1e6) *
          (Number(q.close?.[i] ?? 0) >= Number(q.open?.[i] ?? 0) ? 0.62 : 0.38),
        trades: 0,
        closed: true,
      }))
      .filter((c) => Number.isFinite(c.o) && Number.isFinite(c.c) && Number.isFinite(c.h) && Number.isFinite(c.l));
    cache.set(key, { at: Date.now(), candles: base });
  }

  const folded = aggregate(base, FOLD[interval] ?? 1);
  return folded.slice(-limit);
}

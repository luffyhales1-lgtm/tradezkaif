import { createFileRoute } from "@tanstack/react-router";
import { ScannerEngine, type ScanSource } from "@/components/ScannerEngine";
import type { Candle, Interval } from "@/lib/binance";
import { FX_INSTRUMENTS, fmtFx } from "@/lib/forex";
import { getFxCandles } from "@/lib/forex.functions";

const FX_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const satisfies readonly Interval[];

const forexSource: ScanSource = {
  label: "Forex & metals",
  universeLabel: "Majors, crosses, exotics, XAU/XAG/XPT/XPD/XCU and DXY",
  intervals: FX_INTERVALS,
  list: async (limit) => FX_INSTRUMENTS.slice(0, limit).map((i) => i.symbol),
  candles: async (symbol, interval, limit) =>
    (await getFxCandles({ data: { symbol, interval, limit } })) as Candle[],
  format: fmtFx,
};

export const Route = createFileRoute("/forex")({
  head: () => ({
    meta: [
      { title: "Forex & Metals Scanner — CoTraders" },
      {
        name: "description",
        content:
          "Live forex and metals scanner covering majors, crosses, exotics, gold, silver, platinum, palladium and copper with confluence-scored TP/SL zones.",
      },
      { property: "og:title", content: "Forex & Metals Scanner — CoTraders" },
      {
        property: "og:description",
        content: "High-efficiency FX and metals setups with higher-timeframe confirmation and completion ETA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ScannerEngine
      config={{
        key: "forex",
        title: "Forex & Metals Scanner · Institutional Engine",
        blurb:
          "Same confluence method as the crypto scanners, applied to live FX and metals: EMA structure, RSI, Bollinger, delta proxy, order blocks and liquidity sweeps, then confirmed on a higher timeframe. Every setup carries fixed SL/TP zones and an estimated completion time.",
        defaultInterval: "15m",
        durationMs: 45_000,
        universe: FX_INSTRUMENTS.length,
        results: 5,
        minProbability: 72,
        horizon: "30 minutes – 8 hours",
        useQuant: true,
        source: forexSource,
      }}
    />
  ),
});

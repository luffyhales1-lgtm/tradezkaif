import { createFileRoute } from "@tanstack/react-router";
import { ScannerEngine } from "@/components/ScannerEngine";

export const Route = createFileRoute("/swing")({
  head: () => ({
    meta: [
      { title: "Swing Scanner — CoTraders" },
      {
        name: "description",
        content: "30-second swing scanner across 200 high-volume Binance pairs with confluence-scored TP and SL zones.",
      },
      { property: "og:title", content: "Swing Scanner — CoTraders" },
      { property: "og:description", content: "Confluence-scored swing setups with fixed TP/SL." },
    ],
  }),
  component: () => (
    <ScannerEngine
      config={{
        key: "swing",
        title: "Swing Scanner · Confluence Engine",
        blurb:
          "Scans 200 high-volume Binance pairs. EMA structure, RSI, Bollinger, footprint delta, order blocks, liquidity sweeps and volume momentum are weighted into one confluence score.",
        defaultInterval: "1h",
        durationMs: 30_000,
        universe: 200,
        results: 5,
        minProbability: 68,
        horizon: "Hours to days",
      }}
    />
  ),
});

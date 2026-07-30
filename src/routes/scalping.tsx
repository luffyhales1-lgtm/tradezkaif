import { createFileRoute } from "@tanstack/react-router";
import { ScannerEngine } from "@/components/ScannerEngine";

export const Route = createFileRoute("/scalping")({
  head: () => ({
    meta: [
      { title: "Scalping Scanner — CoTraders" },
      {
        name: "description",
        content: "5-minute scalping scanner over 200 Binance pairs with tight ATR stops and fast take-profit zones.",
      },
      { property: "og:title", content: "Scalping Scanner — CoTraders" },
      { property: "og:description", content: "Fast 5m scalp setups with fixed SL and TP." },
    ],
  }),
  component: () => (
    <ScannerEngine
      config={{
        key: "scalping",
        title: "Scalping Scanner · 5m Engine",
        blurb:
          "Built for 5-minute execution. Requires trend, delta and book agreement before a setup is published, so far fewer but cleaner signals.",
        defaultInterval: "5m",
        durationMs: 30_000,
        universe: 200,
        results: 5,
        minProbability: 72,
        horizon: "15–60 minutes",
      }}
    />
  ),
});

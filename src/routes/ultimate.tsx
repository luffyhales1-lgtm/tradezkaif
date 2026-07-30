import { createFileRoute } from "@tanstack/react-router";
import { ScannerEngine } from "@/components/ScannerEngine";

export const Route = createFileRoute("/ultimate")({
  head: () => ({
    meta: [
      { title: "Ultimate Scanner — CoTraders" },
      {
        name: "description",
        content: "60-second deep scan of 200 Binance pairs combining structure, order flow and quant filters into top setups.",
      },
      { property: "og:title", content: "Ultimate Scanner — CoTraders" },
      { property: "og:description", content: "The deepest CoTraders scan — 60 seconds, top 5 setups." },
    ],
  }),
  component: () => (
    <ScannerEngine
      config={{
        key: "ultimate",
        title: "Ultimate Scanner · 60s Deep Research",
        blurb:
          "Full 60-second pass over 200 pairs. Every technical factor plus Hawkes burst intensity, Bayesian posterior and conformal bands, ranked to the highest-conviction setups only.",
        defaultInterval: "15m",
        durationMs: 60_000,
        universe: 200,
        results: 5,
        minProbability: 75,
        horizon: "Under 1 hour",
        useQuant: true,
      }}
    />
  ),
});

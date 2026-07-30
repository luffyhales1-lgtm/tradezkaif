import { createFileRoute } from "@tanstack/react-router";
import { ScannerEngine } from "@/components/ScannerEngine";
import { Panel } from "@/components/ui-bits";

export const Route = createFileRoute("/math")({
  head: () => ({
    meta: [
      { title: "Math Scanner — Hawkes, Bayes & Kelly — CoTraders" },
      {
        name: "description",
        content: "Quant scanner using Hawkes intensity, Bayesian posteriors, quantile volatility, conformal bands and fractional Kelly sizing.",
      },
      { property: "og:title", content: "Math Scanner — CoTraders" },
      { property: "og:description", content: "Formula-driven setups: Hawkes, Bayes, conformal, Kelly, RMT." },
    ],
  }),
  component: MathScanner,
});

const FORMULAS = [
  { name: "Hawkes process", f: "λ(t)=μ+Σαe^{−β(t−tᵢ)}", why: "Self-exciting order-flow burst intensity" },
  { name: "Bayesian classifier", f: "P(H|E)=P(E|H)P(H)/P(E)", why: "Posterior probability the setup is real" },
  { name: "Quantile volatility", f: "Qτ(r_{t+h}|X_t)", why: "Conditional forward-return quantiles" },
  { name: "Conformal filter", f: "C_t=[ŷ_t−q̂, ŷ_t+q̂]", why: "Calibrated prediction band for TP/SL" },
  { name: "Fractional Kelly", f: "f*=c(bp−q)/b", why: "Position size at the given edge" },
  { name: "Random matrix theory", f: "C=(1/T)XXᵀ → λᵢ", why: "Strips noise eigenvalues from correlation" },
];

function MathScanner() {
  return (
    <div className="space-y-4">
      <Panel title="Formula stack" subtitle="Every signal below is filtered through all six">
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {FORMULAS.map((f) => (
            <div key={f.name} className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-accent">{f.name}</div>
              <div className="num mt-1 text-sm text-foreground">{f.f}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{f.why}</div>
            </div>
          ))}
        </div>
      </Panel>

      <ScannerEngine
        config={{
          key: "math",
          title: "Math Scanner · Quant Only",
          blurb:
            "Pure quantitative pass: technical confluence is re-weighted by the Bayesian posterior, tail quantiles and conformal band width. Only setups that survive every filter are published.",
          defaultInterval: "15m",
          durationMs: 60_000,
          universe: 200,
          results: 5,
          minProbability: 80,
          horizon: "Under 15 minutes",
          useQuant: true,
        }}
      />
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { SymbolPicker } from "@/components/SymbolPicker";
import { Highlighted, Panel, Pill, Stat } from "@/components/ui-bits";
import { useBook, useCandles, useLocalState, useMarkPrice, useSymbolState } from "@/hooks/useMarket";
import { bookAnalysis, liquidityZones } from "@/lib/analysis";
import { fmtPrice, fmtUsd } from "@/lib/binance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/liquidity")({
  head: () => ({
    meta: [
      { title: "Liquidity Map & Sweeps — CoTraders" },
      {
        name: "description",
        content: "High-impact liquidity pools, sweep zones and whale limit orders from $500K to millions.",
      },
      { property: "og:title", content: "Liquidity Map & Sweeps — CoTraders" },
      { property: "og:description", content: "Where price reverses after taking liquidity." },
    ],
  }),
  component: Liquidity,
});

function Liquidity() {
  const { symbol, setSymbol, interval, setInterval } = useSymbolState();
  const { candles } = useCandles(symbol, interval, 400);
  const book = useBook(symbol);
  const price = useMarkPrice(symbol);
  const [minWall, setMinWall] = useLocalState("cotraders.liq.wall", 500_000);

  const zones = useMemo(() => (candles.length > 60 ? liquidityZones(candles) : []), [candles]);
  const ba = useMemo(() => bookAnalysis(book, minWall), [book, minWall]);

  return (
    // overscroll containment keeps the page from jumping while scrolling these lists
    <div className="space-y-4 overscroll-contain">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SymbolPicker symbol={symbol} setSymbol={setSymbol} interval={interval} setInterval={setInterval} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Whale size</span>
          {[500_000, 1_000_000, 2_500_000, 5_000_000].map((v) => (
            <button
              key={v}
              onClick={() => setMinWall(v)}
              className={cn(
                "num rounded border border-border px-2 py-1 text-xs",
                minWall === v ? "border-primary/60 bg-primary/15 text-primary" : "text-muted-foreground",
              )}
            >
              {fmtUsd(v)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Liquidity pools" subtitle="Equal highs / lows still resting">
          <div className="h-[420px] space-y-1.5 overflow-auto scroll-lock">
            {zones
              .filter((z) => z.kind === "liquidity")
              .map((z, i) => (
                <div key={i} className="rounded-lg border border-primary/25 bg-primary/5 p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span>{z.label}</span>
                    <span className="num">
                      {fmtPrice(z.low)} – {fmtPrice(z.high)}
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded bg-secondary">
                    <div className="h-full rounded bg-primary" style={{ width: `${z.strength}%` }} />
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Strength {z.strength.toFixed(0)}% ·{" "}
                    {price > (z.low + z.high) / 2 ? "below price" : "above price"}
                  </p>
                </div>
              ))}
            {!zones.length && <p className="py-8 text-center text-xs text-muted-foreground">Building map…</p>}
          </div>
        </Panel>

        <Panel title="Sweep zones" subtitle="Liquidity already taken — reversal candidates">
          <div className="h-[420px] space-y-1.5 overflow-auto scroll-lock">
            {zones
              .filter((z) => z.kind === "sweep")
              .map((z, i) => (
                <div key={i} className="rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <Pill tone="warn">swept</Pill>
                    <span className="num">
                      {fmtPrice(z.low)} – {fmtPrice(z.high)}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {z.label} — expect reaction if price returns to this band.
                  </p>
                </div>
              ))}
            {!zones.some((z) => z.kind === "sweep") && (
              <p className="py-8 text-center text-xs text-muted-foreground">No sweeps on this timeframe.</p>
            )}
          </div>
        </Panel>

        <Panel title="Whale limit orders" subtitle={`Resting size ≥ ${fmtUsd(minWall)}`}>
          <Highlighted title="Marked walls (stay until you clear)">
            <div className="h-[360px] space-y-1.5 overflow-auto scroll-lock">
              {ba?.walls.map((w) => (
                <div
                  key={`${w.side}-${w.price}`}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs",
                    w.side === "bid" ? "border-bull/40 bg-bull/5" : "border-bear/40 bg-bear/5",
                  )}
                >
                  <span className={w.side === "bid" ? "text-bull" : "text-bear"}>{w.side.toUpperCase()}</span>
                  <span className="num">{fmtPrice(w.price)}</span>
                  <span className="num font-semibold">{fmtUsd(w.usd)}</span>
                </div>
              ))}
              {!ba?.walls.length && (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  No whale limits ≥ {fmtUsd(minWall)} right now.
                </p>
              )}
            </div>
          </Highlighted>
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Bid depth" value={ba ? fmtUsd(ba.bidUsd) : "—"} tone="bull" />
        <Stat label="Ask depth" value={ba ? fmtUsd(ba.askUsd) : "—"} tone="bear" />
        <Stat
          label="Imbalance"
          value={ba ? `${(ba.imbalance * 100).toFixed(1)}%` : "—"}
          tone={(ba?.imbalance ?? 0) >= 0 ? "bull" : "bear"}
        />
        <Stat label="Mark" value={price ? fmtPrice(price) : "—"} />
      </div>
    </div>
  );
}

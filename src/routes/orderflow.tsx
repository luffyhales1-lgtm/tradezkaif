import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { SymbolPicker } from "@/components/SymbolPicker";
import { Panel, Pill, Stat } from "@/components/ui-bits";
import { useBook, useLocalState, useMarkPrice, useSymbolState, useTrades } from "@/hooks/useMarket";
import { fmtPrice, fmtUsd } from "@/lib/binance";
import { pushLog } from "@/lib/bus";
import { bookAnalysis } from "@/lib/analysis";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/orderflow")({
  head: () => ({
    meta: [
      { title: "Order Flow Prints — CoTraders" },
      {
        name: "description",
        content: "Live Binance aggregated trade prints filtered to whale-size orders from $100K to millions.",
      },
      { property: "og:title", content: "Order Flow Prints — CoTraders" },
      { property: "og:description", content: "Whale-size live order flow prints and resting limit walls." },
    ],
  }),
  component: OrderFlow,
});

function OrderFlow() {
  const { symbol, setSymbol } = useSymbolState();
  const [minUsd, setMinUsd] = useLocalState("cotraders.flow.min", 100_000);
  const { trades, stats } = useTrades(symbol, minUsd, 200);
  const book = useBook(symbol);
  const price = useMarkPrice(symbol);
  const seen = useRef(new Set<string>());

  const ba = useMemo(() => bookAnalysis(book, 500_000), [book]);

  useEffect(() => {
    trades.slice(0, 5).forEach((t) => {
      const id = `${t.ts}-${t.price}-${t.qty}`;
      if (seen.current.has(id) || t.usd < 1_000_000) return;
      seen.current.add(id);
      pushLog({
        kind: "flow",
        symbol,
        text: `${t.buyerMaker ? "SELL" : "BUY"} print ${fmtUsd(t.usd)} @ ${fmtPrice(t.price)}`,
        meta: `${t.qty.toFixed(3)} contracts`,
      });
    });
  }, [trades, symbol]);

  const buyUsd = trades.filter((t) => !t.buyerMaker).reduce((a, t) => a + t.usd, 0);
  const sellUsd = trades.filter((t) => t.buyerMaker).reduce((a, t) => a + t.usd, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SymbolPicker symbol={symbol} setSymbol={setSymbol} showInterval={false} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Min size</span>
          {[100_000, 250_000, 500_000, 1_000_000].map((v) => (
            <button
              key={v}
              onClick={() => setMinUsd(v)}
              className={cn(
                "num rounded border border-border px-2 py-1 text-xs",
                minUsd === v ? "border-primary/60 bg-primary/15 text-primary" : "text-muted-foreground",
              )}
            >
              {fmtUsd(v)}
            </button>
          ))}
          <Pill tone={stats?.status === "open" ? "bull" : "warn"}>
            {stats?.status ?? "connecting"}
          </Pill>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Buy prints" value={fmtUsd(buyUsd)} tone="bull" />
        <Stat label="Sell prints" value={fmtUsd(sellUsd)} tone="bear" />
        <Stat
          label="Net flow"
          value={fmtUsd(buyUsd - sellUsd)}
          tone={buyUsd >= sellUsd ? "bull" : "bear"}
        />
        <Stat label="Mark" value={price ? fmtPrice(price) : "—"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel title="Live prints" subtitle={`Only orders ≥ ${fmtUsd(minUsd)}`}>
          <div className="max-h-[560px] overflow-auto scroll-lock">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">Time</th>
                  <th className="px-2 py-1.5 text-left">Side</th>
                  <th className="px-2 py-1.5 text-right">Price</th>
                  <th className="px-2 py-1.5 text-right">Size</th>
                  <th className="px-2 py-1.5 text-right">Notional</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr
                    key={`${t.ts}-${i}`}
                    className={cn(
                      "border-t border-border/50",
                      t.usd >= 1_000_000 && "bg-primary/5",
                    )}
                  >
                    <td className="num px-2 py-1 text-muted-foreground">
                      {new Date(t.ts).toLocaleTimeString()}
                    </td>
                    <td className={cn("px-2 py-1 font-semibold", t.buyerMaker ? "text-bear" : "text-bull")}>
                      {t.buyerMaker ? "SELL" : "BUY"}
                    </td>
                    <td className="num px-2 py-1 text-right">{fmtPrice(t.price)}</td>
                    <td className="num px-2 py-1 text-right">{t.qty.toFixed(3)}</td>
                    <td className="num px-2 py-1 text-right font-semibold">{fmtUsd(t.usd)}</td>
                  </tr>
                ))}
                {!trades.length && (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                      Waiting for prints above {fmtUsd(minUsd)}…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Resting limit walls" subtitle="≥ $500K sitting in the book">
          <div className="max-h-[560px] space-y-1.5 overflow-auto scroll-lock">
            {ba?.walls.map((w) => (
              <div
                key={`${w.side}-${w.price}`}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs",
                  w.side === "bid" ? "border-bull/35 bg-bull/5" : "border-bear/35 bg-bear/5",
                )}
              >
                <span className={cn("font-semibold", w.side === "bid" ? "text-bull" : "text-bear")}>
                  {w.side.toUpperCase()}
                </span>
                <span className="num">{fmtPrice(w.price)}</span>
                <span className="num font-semibold">{fmtUsd(w.usd)}</span>
              </div>
            ))}
            {!ba?.walls.length && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No $500K+ walls resting right now.
              </p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

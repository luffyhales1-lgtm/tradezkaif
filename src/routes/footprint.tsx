import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { SymbolPicker } from "@/components/SymbolPicker";
import { Highlighted, Panel, Pill, Stat } from "@/components/ui-bits";
import { useBook, useCandles, useSymbolState } from "@/hooks/useMarket";
import { bookAnalysis, deltaSeries } from "@/lib/analysis";
import { fmtPrice, fmtUsd } from "@/lib/binance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/footprint")({
  head: () => ({
    meta: [
      { title: "Delta & Footprint Ladder — CoTraders" },
      {
        name: "description",
        content: "Per-candle footprint delta, CVD, order book delta and Roman Urdu market read for Binance futures.",
      },
      { property: "og:title", content: "Delta & Footprint Ladder — CoTraders" },
      { property: "og:description", content: "Per-candle delta with absorption and control flips." },
    ],
  }),
  component: Footprint,
});

function Footprint() {
  const { symbol, setSymbol, interval, setInterval } = useSymbolState();
  const { candles } = useCandles(symbol, interval, 300);
  const book = useBook(symbol);

  const closedKey = candles.length ? candles.at(-1)!.t : 0;
  const rows = useMemo(
    () => (candles.length ? deltaSeries(candles).slice(-40).reverse() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closedKey, symbol, interval],
  );
  const ba = useMemo(() => bookAnalysis(book, 250_000), [book]);

  const cumulative = rows.reduce((a, r) => a + r.delta, 0);
  const control = cumulative > 0 ? "buyers" : "sellers";
  const flips = useMemo(() => {
    const out: { t: number; from: string; to: string; price: number }[] = [];
    const ordered = [...rows].reverse();
    ordered.forEach((r, i) => {
      if (i === 0) return;
      const prev = ordered[i - 1].delta >= 0 ? "buyers" : "sellers";
      const now = r.delta >= 0 ? "buyers" : "sellers";
      if (prev !== now) out.push({ t: r.t, from: prev, to: now, price: r.close });
    });
    return out.slice(-6).reverse();
  }, [rows]);

  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.delta)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SymbolPicker symbol={symbol} setSymbol={setSymbol} interval={interval} setInterval={setInterval} />
        <Pill tone={control === "buyers" ? "bull" : "bear"}>{control} in control</Pill>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Cumulative delta (40)" value={cumulative.toFixed(2)} tone={cumulative >= 0 ? "bull" : "bear"} />
        <Stat label="Last candle delta" value={(rows[0]?.delta ?? 0).toFixed(2)} tone={(rows[0]?.delta ?? 0) >= 0 ? "bull" : "bear"} />
        <Stat label="Absorption candles" value={rows.filter((r) => r.absorbed).length} tone="warn" />
        <Stat label="Book delta" value={ba ? fmtUsd(ba.bidUsd - ba.askUsd) : "—"} tone={(ba?.imbalance ?? 0) >= 0 ? "bull" : "bear"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <Panel title={`Footprint ladder · ${interval}`} subtitle="Per-candle taker buy vs sell with price zone">
          <div className="max-h-[520px] overflow-auto scroll-lock">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left">Time</th>
                  <th className="px-2 py-1.5 text-right">Zone</th>
                  <th className="px-2 py-1.5 text-right">Buy</th>
                  <th className="px-2 py-1.5 text-right">Sell</th>
                  <th className="px-2 py-1.5 text-right">Delta</th>
                  <th className="px-2 py-1.5">Bar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.t}
                    className={cn(
                      "border-t border-border/50",
                      Math.abs(r.delta) > maxAbs * 0.7 && "bg-primary/10",
                    )}
                  >
                    <td className="num px-2 py-1 text-muted-foreground">
                      {new Date(r.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="num px-2 py-1 text-right text-muted-foreground">
                      {fmtPrice(r.low)}–{fmtPrice(r.high)}
                    </td>
                    <td className="num px-2 py-1 text-right text-bull">{r.buy.toFixed(1)}</td>
                    <td className="num px-2 py-1 text-right text-bear">{r.sell.toFixed(1)}</td>
                    <td className={cn("num px-2 py-1 text-right font-semibold", r.delta >= 0 ? "text-bull" : "text-bear")}>
                      {r.delta >= 0 ? "+" : ""}
                      {r.delta.toFixed(1)}
                    </td>
                    <td className="px-2 py-1">
                      <div className="h-1.5 w-full rounded bg-secondary">
                        <div
                          className={cn("h-full rounded", r.delta >= 0 ? "bg-bull" : "bg-bear")}
                          style={{ width: `${(Math.abs(r.delta) / maxAbs) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Market read (Roman Urdu)">
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Abhi <span className="font-semibold text-foreground">{control === "buyers" ? "buyers" : "sellers"}</span>{" "}
                control mein hain — pichle {rows.length} candles ka net delta{" "}
                <span className="num text-foreground">{cumulative.toFixed(1)}</span> hai.
              </p>
              <p className="text-muted-foreground">
                {rows[0]?.absorbed
                  ? "Last candle mein absorption dikh raha hai: bara delta lekin price nahi chala — reversal ka risk."
                  : "Last candle mein delta aur price direction match kar rahe hain — continuation zyada likely."}
              </p>
              <p className="text-muted-foreground">
                Order book abhi{" "}
                <span className="font-semibold text-foreground">
                  {(ba?.imbalance ?? 0) >= 0 ? "bid heavy" : "ask heavy"}
                </span>{" "}
                hai ({((ba?.imbalance ?? 0) * 100).toFixed(1)}%).
              </p>
            </div>
          </Panel>

          <Panel title="Control flips" subtitle="Kab position change hui">
            <div className="space-y-1.5">
              {flips.map((f) => (
                <div key={f.t} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-xs">
                  <span className="num text-muted-foreground">
                    {new Date(f.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span>
                    {f.from} → <span className={f.to === "buyers" ? "text-bull" : "text-bear"}>{f.to}</span>
                  </span>
                  <span className="num">{fmtPrice(f.price)}</span>
                </div>
              ))}
              {!flips.length && <p className="text-xs text-muted-foreground">No flips in this window.</p>}
            </div>
          </Panel>

          <Panel title="Order book delta" subtitle="Aggregated bid vs ask notional">
            <Highlighted title="Top book levels">
              <div className="max-h-56 space-y-1 overflow-auto scroll-lock text-xs">
                {ba?.walls.slice(0, 12).map((w) => (
                  <div key={`${w.side}-${w.price}`} className="flex justify-between">
                    <span className={w.side === "bid" ? "text-bull" : "text-bear"}>{w.side}</span>
                    <span className="num">{fmtPrice(w.price)}</span>
                    <span className="num">{fmtUsd(w.usd)}</span>
                  </div>
                ))}
                {!ba?.walls.length && <p className="text-muted-foreground">No large levels.</p>}
              </div>
            </Highlighted>
          </Panel>
        </div>
      </div>
    </div>
  );
}

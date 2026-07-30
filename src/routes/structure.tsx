import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SymbolPicker } from "@/components/SymbolPicker";
import { Panel, Pill, Stat } from "@/components/ui-bits";
import { useSymbolState } from "@/hooks/useMarket";
import { fetchKlines, fmtPrice, type Interval } from "@/lib/binance";
import { analyze, srZones } from "@/lib/analysis";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/structure")({
  head: () => ({
    meta: [
      { title: "Support, Resistance & Pullback Zones — CoTraders" },
      {
        name: "description",
        content: "Multi-timeframe support and resistance with pull-back and pull-down zones for any Binance pair.",
      },
      { property: "og:title", content: "Support & Resistance Zones — CoTraders" },
      { property: "og:description", content: "High-conviction S/R across every timeframe." },
    ],
  }),
  component: Structure,
});

const TFS: Interval[] = ["5m", "15m", "1h", "4h", "1d"];

type Row = {
  tf: Interval;
  price: number;
  bias: string;
  support: { low: number; high: number; strength: number }[];
  resistance: { low: number; high: number; strength: number }[];
};

function Structure() {
  const { symbol, setSymbol } = useSymbolState();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(
      TFS.map(async (tf) => {
        const candles = await fetchKlines(symbol, tf, 300);
        const zones = srZones(candles, 8);
        const a = analyze(symbol, candles, tf);
        return {
          tf,
          price: a.price,
          bias: a.signal.bias,
          support: zones.filter((z) => z.kind === "support" && z.strength > 45).slice(0, 3),
          resistance: zones.filter((z) => z.kind === "resistance" && z.strength > 45).slice(0, 3),
        } satisfies Row;
      }),
    )
      .then((r) => alive && setRows(r))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbol]);

  return (
    <div className="space-y-4">
      <SymbolPicker symbol={symbol} setSymbol={setSymbol} showInterval={false} />
      {loading && <Panel><p className="text-sm text-muted-foreground">Mapping structure across 5 timeframes…</p></Panel>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <Panel
            key={r.tf}
            title={`${symbol} · ${r.tf}`}
            right={<Pill tone={r.bias === "long" ? "bull" : r.bias === "short" ? "bear" : "default"}>{r.bias}</Pill>}
          >
            <Stat label="Price" value={fmtPrice(r.price)} />
            <div className="mt-3 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-bear">Resistance / pull-down</div>
              {r.resistance.map((z, i) => (
                <div key={i} className={cn("flex justify-between rounded border border-bear/40 bg-bear/5 px-2 py-1 text-xs")}>
                  <span className="num">
                    {fmtPrice(z.low)} – {fmtPrice(z.high)}
                  </span>
                  <span className="num text-muted-foreground">{z.strength.toFixed(0)}%</span>
                </div>
              ))}
              {!r.resistance.length && <p className="text-xs text-muted-foreground">No high-conviction level above.</p>}
              <div className="pt-2 text-[10px] uppercase tracking-wider text-bull">Support / pull-back</div>
              {r.support.map((z, i) => (
                <div key={i} className="flex justify-between rounded border border-bull/40 bg-bull/5 px-2 py-1 text-xs">
                  <span className="num">
                    {fmtPrice(z.low)} – {fmtPrice(z.high)}
                  </span>
                  <span className="num text-muted-foreground">{z.strength.toFixed(0)}%</span>
                </div>
              ))}
              {!r.support.length && <p className="text-xs text-muted-foreground">No high-conviction level below.</p>}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

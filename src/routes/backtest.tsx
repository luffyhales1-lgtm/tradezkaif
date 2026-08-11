import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Panel, Pill, Stat } from "@/components/ui-bits";
import { useBacktest } from "@/hooks/useBacktest";
import { setBacktestInterval, startBacktestEngine, stopBacktestEngine } from "@/lib/backtest-engine";
import { summarise } from "@/lib/backtest";
import { INTERVALS, fmtPrice, type Interval } from "@/lib/binance";
import { downloadReportPdf } from "@/lib/pdf";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/backtest")({
  head: () => ({
    meta: [
      { title: "Backtest & Replay — CoTraders" },
      {
        name: "description",
        content:
          "Always-on replay of the Ultimate scanner presets over recent candles with SL vs TP hit rates and PDF reporting.",
      },
      { property: "og:title", content: "Backtest & Replay — CoTraders" },
      { property: "og:description", content: "Live SL vs TP hit-rate replay of the Ultimate scanner filters." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BacktestPage,
});

function BacktestPage() {
  const state = useBacktest(true);
  const [symbolFilter, setSymbolFilter] = useState("");

  const trades = useMemo(
    () =>
      state.trades.filter((t) =>
        symbolFilter ? t.symbol.toLowerCase().includes(symbolFilter.toLowerCase()) : true,
      ),
    [state.trades, symbolFilter],
  );
  const stats = useMemo(() => summarise(trades), [trades]);

  const bySymbol = useMemo(() => {
    const map = new Map<string, typeof trades>();
    trades.forEach((t) => map.set(t.symbol, [...(map.get(t.symbol) ?? []), t]));
    return [...map.entries()]
      .map(([symbol, list]) => ({ symbol, ...summarise(list) }))
      .filter((row) => row.trades >= 2)
      .sort((a, b) => b.winRate - a.winRate);
  }, [trades]);

  const exportPdf = () =>
    downloadReportPdf({
      title: "Backtest / Replay report",
      subtitle: `${state.interval} replay · ${stats.trades} setups · cycle ${state.cycle}`,
      fileName: `cotraders-backtest-${Date.now()}.pdf`,
      sections: [
        {
          heading: "Headline",
          lines: [
            `Trades replayed: ${stats.trades} (closed ${stats.tp + stats.sl}, still open ${stats.open})`,
            `TP hits: ${stats.tp} · SL hits: ${stats.sl} · win rate ${stats.winRate.toFixed(1)}%`,
            `Expectancy: ${stats.expectancyR.toFixed(2)}R · average hold ${stats.avgBars.toFixed(1)} bars`,
            `Filters — min probability ${state.settings.minProbability}%, HTF ${state.settings.htfStrength}%, structure ${state.settings.structureStrength}%, max ATR ${state.settings.maxAtrPct}%, min R:R ${state.settings.minRiskReward}`,
          ],
        },
        {
          heading: "Per-symbol hit rate",
          table: {
            headers: ["Symbol", "Trades", "TP", "SL", "Win %", "Exp R"],
            rows: bySymbol
              .slice(0, 40)
              .map((r) => [r.symbol, r.trades, r.tp, r.sl, r.winRate.toFixed(1), r.expectancyR.toFixed(2)]),
          },
        },
        {
          heading: "Latest replayed setups",
          table: {
            headers: ["Symbol", "Bias", "Entry", "SL", "TP", "Result", "Bars"],
            rows: trades
              .slice(0, 60)
              .map((t) => [
                t.symbol,
                t.bias,
                fmtPrice(t.entry),
                fmtPrice(t.stop),
                fmtPrice(t.target),
                t.outcome.toUpperCase(),
                t.bars,
              ]),
          },
        },
      ],
    });

  return (
    <div className="space-y-4">
      <Panel
        title="Backtest & Replay · always on"
        subtitle="Starts automatically when the site opens and keeps replaying the Ultimate scanner presets in the background until you close the tab."
        right={
          <div className="flex gap-2">
            <button
              onClick={() => (state.running ? stopBacktestEngine() : startBacktestEngine())}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-semibold",
                state.running ? "border-warn/50 bg-warn/10 text-warn" : "border-primary/50 bg-primary/10 text-primary",
              )}
            >
              {state.running ? "Pause engine" : "Resume engine"}
            </button>
            <button
              onClick={exportPdf}
              className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent"
            >
              Download PDF
            </button>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Replay timeframe</span>
          {INTERVALS.map((i: Interval) => (
            <button
              key={i}
              onClick={() => setBacktestInterval(i)}
              className={cn(
                "num rounded border border-border px-2 py-1 text-xs",
                i === state.interval ? "border-primary/60 bg-primary/15 text-primary" : "text-muted-foreground",
              )}
            >
              {i}
            </button>
          ))}
          <input
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            placeholder="Filter symbol"
            className="ml-auto w-40 rounded border border-border bg-background px-2 py-1 text-xs"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Stat label="Setups" value={stats.trades} hint={`cycle ${state.cycle}`} />
          <Stat label="TP hits" value={stats.tp} tone="bull" />
          <Stat label="SL hits" value={stats.sl} tone="bear" />
          <Stat label="Win rate" value={`${stats.winRate.toFixed(1)}%`} tone={stats.winRate >= 60 ? "bull" : "warn"} />
          <Stat label="Expectancy" value={`${stats.expectancyR.toFixed(2)}R`} tone={stats.expectancyR >= 0 ? "bull" : "bear"} />
          <Stat label="Avg hold" value={`${stats.avgBars.toFixed(1)} bars`} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Pill tone={state.running ? "bull" : "warn"}>{state.running ? "running in background" : "paused"}</Pill>
          <span>
            {state.current ? `replaying ${state.current}` : "idle between cycles"} · {state.symbolsDone}/
            {state.symbolsTotal} symbols
          </span>
          {state.error && <span className="text-bear">{state.error}</span>}
        </div>
      </Panel>

      <Panel title="Filter tuning" subtitle="Which presets minimise SL hits — the engine uses your saved Ultimate scanner settings">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Stat label="Min probability" value={`${state.settings.minProbability}%`} />
          <Stat label="HTF strength" value={`${state.settings.htfStrength}%`} />
          <Stat label="Structure" value={`${state.settings.structureStrength}%`} />
          <Stat label="Max ATR" value={`${state.settings.maxAtrPct}%`} />
          <Stat label="Min R:R" value={`${state.settings.minRiskReward}R`} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Change these on the Ultimate scanner — the replay picks them up on the next cycle, so you can see instantly
          whether tighter filters reduce SL hits.
        </p>
      </Panel>

      <Panel title="Per-symbol hit rate" subtitle="Sorted by win rate — drop the bottom names from your watchlist">
        <div className="max-h-80 overflow-auto text-xs">
          {bySymbol.map((row) => (
            <div key={row.symbol} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 border-t border-border py-1.5">
              <span className="num font-semibold">{row.symbol}</span>
              <span className="num text-muted-foreground">{row.trades} trades</span>
              <span className="num text-bull">{row.tp} TP</span>
              <span className="num text-bear">{row.sl} SL</span>
              <span className={cn("num", row.winRate >= 60 ? "text-bull" : "text-warn")}>{row.winRate.toFixed(0)}%</span>
            </div>
          ))}
          {!bySymbol.length && <p className="py-6 text-center text-muted-foreground">Warming up the replay engine…</p>}
        </div>
      </Panel>
    </div>
  );
}

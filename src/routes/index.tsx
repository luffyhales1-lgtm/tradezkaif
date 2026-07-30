import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CandleChart, type ChartLine, type ChartZone } from "@/components/CandleChart";
import { SymbolPicker } from "@/components/SymbolPicker";
import { Panel, Pill, Stat } from "@/components/ui-bits";
import { useBook, useCandles, useMarkPrice, useSymbolState, useLocalState } from "@/hooks/useMarket";
import { analyze } from "@/lib/analysis";
import { fmtPrice, fmtUsd } from "@/lib/binance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CoTraders Terminal — Live Binance Chart, Long & Short Zones" },
      {
        name: "description",
        content:
          "Live Binance futures chart with locked long/short TP-SL zones, order blocks, liquidity and Fibonacci overlays.",
      },
      { property: "og:title", content: "CoTraders Terminal" },
      {
        property: "og:description",
        content: "Live Binance chart with locked TP/SL zones and confluence analysis.",
      },
    ],
  }),
  component: Terminal,
});

type Overlay = "long" | "short" | "liquidity" | "ob" | "fib" | "sr";

function Terminal() {
  const { symbol, setSymbol, interval, setInterval } = useSymbolState();
  const { candles, loading } = useCandles(symbol, interval, 400);
  const book = useBook(symbol);
  const mark = useMarkPrice(symbol);
  const [overlays, setOverlays] = useLocalState<Overlay[]>("cotraders.overlays", [
    "long",
    "short",
    "liquidity",
  ]);
  const [locked, setLocked] = useLocalState<Record<string, { long: number[]; short: number[] }>>(
    "cotraders.zonelock",
    {},
  );
  const [tab, setTab] = useState<"long" | "short">("long");

  // Recompute only when a candle closes — this is what keeps SL/TP from
  // shifting on every tick (zone-lock debounce).
  const closedKey = candles.length ? `${candles.at(-1)!.t}` : "";
  const analysis = useMemo(
    () => (candles.length > 200 ? analyze(symbol, candles, interval, book) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol, interval, closedKey, candles.length > 200, book?.ts ? Math.floor(book.ts / 10000) : 0],
  );

  const lock = locked[`${symbol}:${interval}`];
  const has = (o: Overlay) => overlays.includes(o);
  const toggle = (o: Overlay) =>
    setOverlays(has(o) ? overlays.filter((x) => x !== o) : [...overlays, o]);

  const { zones, lines, longPlan, shortPlan } = useMemo(() => {
    const z: ChartZone[] = [];
    const l: ChartLine[] = [];
    if (!analysis) return { zones: z, lines: l, longPlan: null, shortPlan: null };
    const price = analysis.price;
    const dist = analysis.atr * 1.35;

    const longPlan = {
      entry: price,
      stop: lock?.long?.[0] ?? price - dist,
      targets: lock?.long?.slice(1) ?? [price + dist * 1.2, price + dist * 2, price + dist * 3.2],
    };
    const shortPlan = {
      entry: price,
      stop: lock?.short?.[0] ?? price + dist,
      targets: lock?.short?.slice(1) ?? [price - dist * 1.2, price - dist * 2, price - dist * 3.2],
    };

    if (has("sr")) {
      analysis.sr.slice(0, 4).forEach((s) =>
        z.push({
          low: s.low,
          high: s.high,
          color:
            s.kind === "support" ? "rgba(61,220,151,0.10)" : "rgba(255,95,86,0.10)",
          label: s.label,
          group: "sr",
        }),
      );
    }
    if (has("ob")) {
      analysis.obs.forEach((o) =>
        z.push({
          low: o.low,
          high: o.high,
          color: o.kind === "ob-bull" ? "rgba(61,220,151,0.16)" : "rgba(255,95,86,0.16)",
          label: `${o.label} ${fmtPrice(o.low)}–${fmtPrice(o.high)}`,
          group: "ob",
        }),
      );
    }
    if (has("liquidity")) {
      analysis.liq.forEach((o) =>
        z.push({
          low: o.low,
          high: o.high,
          color: o.kind === "sweep" ? "rgba(255,193,64,0.18)" : "rgba(120,180,255,0.14)",
          label: o.label,
          group: "liquidity",
        }),
      );
    }
    if (has("fib") && analysis.fib) {
      analysis.fib.levels
        .filter((f) => f.ratio !== 0 && f.ratio !== 1)
        .forEach((f) =>
          l.push({
            price: f.price,
            color: f.golden ? "rgba(255,193,64,0.9)" : "rgba(255,255,255,0.25)",
            label: `fib ${f.ratio}`,
            dashed: true,
            group: "fib",
          }),
        );
    }
    if (has("long")) {
      l.push({ price: longPlan.stop, color: "#ff5f56", label: "LONG SL", group: "long" });
      longPlan.targets.forEach((t, i) =>
        l.push({ price: t, color: "#3ddc97", label: `LONG TP${i + 1}`, group: "long" }),
      );
    }
    if (has("short")) {
      l.push({ price: shortPlan.stop, color: "#ff8f56", label: "SHORT SL", dashed: true, group: "short" });
      shortPlan.targets.forEach((t, i) =>
        l.push({ price: t, color: "#56c8ff", label: `SHORT TP${i + 1}`, dashed: true, group: "short" }),
      );
    }
    return { zones: z, lines: l, longPlan, shortPlan };
  }, [analysis, overlays, lock]);

  const plan = tab === "long" ? longPlan : shortPlan;
  const bias = analysis?.signal.bias ?? "neutral";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SymbolPicker
          symbol={symbol}
          setSymbol={setSymbol}
          interval={interval}
          setInterval={setInterval}
        />
        <div className="flex items-center gap-3">
          <div className="num text-2xl font-bold">{mark ? fmtPrice(mark) : "—"}</div>
          <Pill tone={bias === "long" ? "bull" : bias === "short" ? "bear" : "default"}>
            {bias} bias {analysis ? `· ${analysis.signal.probability}%` : ""}
          </Pill>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel
          title={`${symbol} · ${interval}`}
          subtitle="Binance USDⓈ-M live stream · zoom with scroll, pan with drag"
          right={
            <div className="flex flex-wrap gap-1">
              {(["long", "short", "liquidity", "ob", "fib", "sr"] as Overlay[]).map((o) => (
                <button
                  key={o}
                  onClick={() => toggle(o)}
                  className={cn(
                    "rounded border px-2 py-1 text-[10px] uppercase tracking-wider",
                    has(o)
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          }
        >
          {loading ? (
            <div className="grid h-[460px] place-items-center text-sm text-muted-foreground">
              Loading live candles…
            </div>
          ) : (
            <CandleChart candles={candles} zones={zones} lines={lines} symbol={symbol} />
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Long / Short desk" subtitle="Zone-locked TP & SL — no re-render drift">
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
              {(["long", "short"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded py-1.5 text-xs font-semibold uppercase",
                    tab === t
                      ? t === "long"
                        ? "bg-bull/20 text-bull"
                        : "bg-bear/20 text-bear"
                      : "text-muted-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            {plan && analysis ? (
              <div className="space-y-2">
                <Stat label="Entry zone" value={fmtPrice(plan.entry)} />
                <Stat label="Stop loss" value={fmtPrice(plan.stop)} tone="bear" />
                {plan.targets.map((t, i) => (
                  <Stat key={i} label={`Take profit ${i + 1}`} value={fmtPrice(t)} tone="bull" />
                ))}
                <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                  <p className="mb-1 font-semibold text-foreground">
                    {tab === bias ? "Aligned with structure" : "Counter-trend — reduce size"}
                  </p>
                  <p>
                    Potential:{" "}
                    <span className="num text-foreground">
                      {(
                        (Math.abs(plan.targets[2] - plan.entry) / plan.entry) *
                        100
                      ).toFixed(2)}
                      %
                    </span>{" "}
                    to TP3 · R:R {analysis.signal.rr.toFixed(2)}
                  </p>
                  {analysis.obs.length > 0 && (
                    <p className="mt-1">
                      Nearest OB:{" "}
                      <span className="num">
                        {fmtPrice(analysis.obs.at(-1)!.low)}–{fmtPrice(analysis.obs.at(-1)!.high)}
                      </span>
                    </p>
                  )}
                </div>
                <button
                  onClick={() =>
                    setLocked({
                      ...locked,
                      [`${symbol}:${interval}`]: {
                        long: lock?.long ?? [longPlan!.stop, ...longPlan!.targets],
                        short: lock?.short ?? [shortPlan!.stop, ...shortPlan!.targets],
                      },
                    })
                  }
                  className="w-full rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground"
                >
                  {lock ? "Zones locked ✓ (re-lock)" : "Lock these zones"}
                </button>
                {lock && (
                  <button
                    onClick={() => {
                      const next = { ...locked };
                      delete next[`${symbol}:${interval}`];
                      setLocked(next);
                    }}
                    className="w-full rounded-lg border border-border py-1.5 text-xs text-muted-foreground"
                  >
                    Unlock zones
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Warming up analysis engine…</p>
            )}
          </Panel>

          <Panel title="Book snapshot">
            {analysis?.book ? (
              <div className="space-y-2">
                <Stat
                  label="Imbalance"
                  value={`${(analysis.book.imbalance * 100).toFixed(1)}%`}
                  tone={analysis.book.imbalance > 0 ? "bull" : "bear"}
                  hint={analysis.book.imbalance > 0 ? "bid heavy" : "ask heavy"}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Bid depth" value={fmtUsd(analysis.book.bidUsd)} tone="bull" />
                  <Stat label="Ask depth" value={fmtUsd(analysis.book.askUsd)} tone="bear" />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Streaming order book…</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

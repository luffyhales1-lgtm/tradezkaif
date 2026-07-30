import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { SymbolPicker } from "@/components/SymbolPicker";
import { Panel, Pill, Stat } from "@/components/ui-bits";
import { useCandles, useSymbolState } from "@/hooks/useMarket";
import { analyze } from "@/lib/analysis";
import { fmtPrice } from "@/lib/binance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/fib")({
  head: () => ({
    meta: [
      { title: "Fibonacci Zones & TP / SL Map — CoTraders" },
      {
        name: "description",
        content: "Plain-language Fibonacci retracement and extension map with entry, stop and take-profit placement.",
      },
      { property: "og:title", content: "Fibonacci Zones & TP/SL Map — CoTraders" },
      { property: "og:description", content: "Golden pocket entries with mapped TP and SL levels." },
    ],
  }),
  component: Fib,
});

function Fib() {
  const { symbol, setSymbol, interval, setInterval } = useSymbolState();
  const { candles } = useCandles(symbol, interval, 400);
  const closedKey = candles.length ? candles.at(-1)!.t : 0;
  const a = useMemo(
    () => (candles.length > 200 ? analyze(symbol, candles, interval) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol, interval, closedKey, candles.length > 200],
  );

  return (
    <div className="space-y-4">
      <SymbolPicker symbol={symbol} setSymbol={setSymbol} interval={interval} setInterval={setInterval} />
      {!a?.fib ? (
        <Panel>
          <p className="text-sm text-muted-foreground">Loading swing range…</p>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Swing high" value={fmtPrice(a.fib.hi)} tone="bear" />
            <Stat label="Swing low" value={fmtPrice(a.fib.lo)} tone="bull" />
            <Stat label="Leg direction" value={a.fib.direction === "up" ? "Bullish leg" : "Bearish leg"} />
            <Stat label="Price" value={fmtPrice(a.price)} />
          </div>

          <Panel
            title="What this map means"
            subtitle="Read it top to bottom — no chart knowledge needed"
          >
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>
                • The swing runs from <span className="num text-foreground">{fmtPrice(a.fib.lo)}</span> to{" "}
                <span className="num text-foreground">{fmtPrice(a.fib.hi)}</span>.
              </li>
              <li>
                • The <span className="text-warn">golden pocket (0.618–0.705)</span> is the highest-probability
                entry band — that is where price usually reacts.
              </li>
              <li>
                • Levels below 0.5 are shallow pullbacks (trend strong). Beyond 0.786 the leg is usually invalid —
                that is where the stop belongs.
              </li>
              <li>
                • 1.272 and 1.618 are extension targets: use them as TP2 and TP3.
              </li>
            </ul>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <Panel title="Fibonacci ladder">
              <div className="space-y-1">
                {a.fib.levels.map((l) => {
                  const near = Math.abs(l.price - a.price) / a.price < 0.004;
                  return (
                    <div
                      key={l.ratio}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
                        l.golden
                          ? "border-warn/50 bg-warn/10"
                          : near
                            ? "border-primary/50 bg-primary/10"
                            : "border-border",
                      )}
                    >
                      <span className="num">{l.ratio}</span>
                      <span className="num font-semibold">{fmtPrice(l.price)}</span>
                      <span className="text-xs text-muted-foreground">
                        {l.ratio === 0 || l.ratio === 1
                          ? "Swing anchor"
                          : l.golden
                            ? "Golden pocket — entry"
                            : l.ratio > 1
                              ? "Extension — take profit"
                              : "Retracement"}
                      </span>
                      {near && <Pill tone="primary">price here</Pill>}
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="TP / SL map" subtitle="Built from ATR + fib extensions">
              <div className="space-y-2">
                <Stat label="Bias" value={a.signal.bias.toUpperCase()} tone={a.signal.bias === "long" ? "bull" : "bear"} />
                <Stat label="Entry" value={fmtPrice(a.signal.entry)} />
                <Stat label="Stop" value={fmtPrice(a.signal.stop)} tone="bear" />
                {a.signal.targets.map((t, i) => (
                  <Stat key={i} label={`TP${i + 1}`} value={fmtPrice(t)} tone="bull" />
                ))}
                <p className="text-xs text-muted-foreground">
                  Risk {(Math.abs(a.signal.entry - a.signal.stop) / a.signal.entry * 100).toFixed(2)}% · reward to TP3{" "}
                  {(Math.abs(a.signal.targets[2] - a.signal.entry) / a.signal.entry * 100).toFixed(2)}%
                </p>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

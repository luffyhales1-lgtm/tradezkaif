import { createFileRoute } from "@tanstack/react-router";
import { SymbolPicker } from "@/components/SymbolPicker";
import { Highlighted, Panel, Pill, Stat } from "@/components/ui-bits";
import { useBook, useLocalState, useMarkPrice, useNow, useSymbolState } from "@/hooks/useMarket";
import { CONFIRM_MS, HIGH_RISK, useCountdown, useSpoofRadar } from "@/hooks/useSpoof";
import { fmtPrice, fmtUsd } from "@/lib/binance";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/spoofing")({
  head: () => ({
    meta: [
      { title: "Spoof Radar — CoTraders" },
      {
        name: "description",
        content: "30-second confirmation spoof radar tracking million-dollar walls that get cancelled before price arrives.",
      },
      { property: "og:title", content: "Spoof Radar — CoTraders" },
      { property: "og:description", content: "Confirmed spoofing with percentage confidence per zone." },
    ],
  }),
  component: Spoofing,
});

function Spoofing() {
  const { symbol, setSymbol } = useSymbolState();
  const book = useBook(symbol);
  const price = useMarkPrice(symbol);
  const [minUsd, setMinUsd] = useLocalState("cotraders.spoof.min", 1_000_000);
  const { tracking, confirmed, spoofPct } = useSpoofRadar(symbol, book, price, minUsd);
  const left = useCountdown(CONFIRM_MS / 1000);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SymbolPicker symbol={symbol} setSymbol={setSymbol} showInterval={false} />
        <div className="flex items-center gap-2">
          {[500_000, 1_000_000, 2_000_000, 5_000_000].map((v) => (
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
          <div className="num flex size-14 items-center justify-center rounded-full border-2 border-primary/60 text-lg font-bold text-primary">
            {left}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Spoof ratio" value={`${spoofPct}%`} tone={spoofPct > 50 ? "bear" : "bull"} hint="of confirmed walls" />
        <Stat label="Tracking" value={tracking.length} hint="walls under 30s watch" />
        <Stat label="Confirmed events" value={confirmed.length} />
        <Stat label="Mark" value={price ? fmtPrice(price) : "—"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Radar · tracking" subtitle="Each wall needs 30s before it is judged">
          <div className="max-h-[460px] space-y-1.5 overflow-auto scroll-lock">
            {tracking.map((t) => {
              const age = Math.min(CONFIRM_MS, Date.now() - t.firstSeen);
              return (
                <div key={t.id} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <Pill tone={t.side === "bid" ? "bull" : "bear"}>{t.side}</Pill>
                    <span className="num">{fmtPrice(t.price)}</span>
                    <span className="num font-semibold">{fmtUsd(t.usd)}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded bg-secondary">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${(age / CONFIRM_MS) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {!tracking.length && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No walls above {fmtUsd(minUsd)} yet — radar is live.
              </p>
            )}
          </div>
        </Panel>

        <Panel title="Confirmed after 30s" subtitle="Spoof = pulled before price arrived">
          <Highlighted title="Highlighted spoof zones">
            <div className="max-h-[400px] space-y-1.5 overflow-auto scroll-lock">
              {confirmed.map((c) => (
                <div
                  key={`${c.id}-${c.firstSeen}`}
                  className={cn(
                    "rounded-lg border p-2.5 text-xs",
                    c.status === "spoof"
                      ? "border-bear/50 bg-bear/10"
                      : c.status === "real"
                        ? "border-bull/50 bg-bull/10"
                        : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold uppercase">
                      {c.status === "spoof" ? "SPOOF" : c.status === "real" ? "REAL WALL" : "FILLED"}
                    </span>
                    <span className="num">{fmtPrice(c.price)}</span>
                    <span className="num">{fmtUsd(c.peakUsd)}</span>
                  </div>
                  {c.status === "spoof" && (
                    <p className="mt-1 text-muted-foreground">
                      {c.confidence}/100 confidence · {fmtUsd(c.cancelledUsd)} cancelled ·{" "}
                      {c.side === "bid" ? "fake bid support" : "fake ask resistance"}
                    </p>
                  )}
                </div>
              ))}
              {!confirmed.length && (
                <p className="py-8 text-center text-muted-foreground">
                  Nothing confirmed yet. First verdicts land 30s after a wall appears.
                </p>
              )}
            </div>
          </Highlighted>
        </Panel>
      </div>
    </div>
  );
}

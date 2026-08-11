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
  const [minUsd, setMinUsd] = useLocalState("cotraders.spoof.min2", 250_000);
  const [riskThreshold, setRiskThreshold] = useLocalState("cotraders.spoof.risk", HIGH_RISK);
  const { tracking, confirmed, spoofPct } = useSpoofRadar(symbol, book, price, minUsd);
  const left = useCountdown(CONFIRM_MS / 1000);
  const now = useNow(500);
  const highRisk = tracking.filter((t) => t.risk >= riskThreshold);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SymbolPicker symbol={symbol} setSymbol={setSymbol} showInterval={false} />
        <div className="flex items-center gap-2">
          {[100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000].map((v) => (
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
          <label className="text-[10px] text-muted-foreground">
            Mark spoofing ≥ {riskThreshold}/100
            <input type="range" min="60" max="95" value={riskThreshold} onChange={(event) => setRiskThreshold(Number(event.target.value))} className="block w-28 accent-primary" />
          </label>
          <div className="num flex size-14 items-center justify-center rounded-full border-2 border-primary/60 text-lg font-bold text-primary">
            {left}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Spoof ratio" value={`${spoofPct}%`} tone={spoofPct > 50 ? "bear" : "bull"} hint="of confirmed walls" />
        <Stat label="Tracking" value={tracking.length} hint="walls under 30s watch" />
        <Stat
          label={`Risk ≥ ${riskThreshold}`}
          value={highRisk.length}
          tone={highRisk.length ? "bear" : "bull"}
          hint="live spoof suspects"
        />
        <Stat label="Confirmed events" value={confirmed.length} />
        <Stat label="Mark" value={price ? fmtPrice(price) : "—"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Radar · tracking"
          subtitle={`Each wall needs 30s before it is judged · flagged above ${riskThreshold}/100`}
          right={
            <button
              onClick={() =>
                downloadReportPdf({
                  title: `Spoof Radar · ${symbol}`,
                  subtitle: `${tracking.length} walls tracked · ${confirmed.length} confirmed · spoof ratio ${spoofPct}% · threshold ${riskThreshold}/100`,
                  fileName: `cotraders-spoof-${symbol}-${Date.now()}.pdf`,
                  sections: [
                    {
                      heading: "Tracking",
                      table: {
                        headers: ["Side", "Price", "Size", "Peak", "Risk"],
                        rows: tracking.map((t) => [
                          t.side,
                          fmtPrice(t.price),
                          fmtUsd(t.usd),
                          fmtUsd(t.peakUsd),
                          `${t.risk}/100`,
                        ]),
                      },
                    },
                    {
                      heading: "Confirmed events",
                      table: {
                        headers: ["Side", "Price", "Peak", "Verdict", "Risk"],
                        rows: confirmed.map((c) => [
                          c.side,
                          fmtPrice(c.price),
                          fmtUsd(c.peakUsd),
                          c.status === "spoof" ? "SPOOF (pulled)" : c.status === "real" ? "REAL (held)" : c.status,
                          `${c.risk}/100`,
                        ]),
                      },
                    },
                  ],
                })
              }
              className="rounded-lg border border-bull/50 bg-bull/10 px-3 py-1.5 text-xs font-semibold text-bull"
            >
              Download PDF
            </button>
          }
        >

          <div className="max-h-[460px] space-y-1.5 overflow-auto scroll-lock">
            {tracking.map((t) => {
              const age = Math.min(CONFIRM_MS, now - t.firstSeen);
               const hot = t.risk >= riskThreshold;
              return (
                <div
                  key={t.id}
                  className={cn(
                    "rounded-lg border p-2.5",
                    hot ? "border-bear/60 bg-bear/10" : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between text-xs">
                    <Pill tone={t.side === "bid" ? "bull" : "bear"}>{t.side}</Pill>
                    <span className="num">{fmtPrice(t.price)}</span>
                    <span className="num font-semibold">{fmtUsd(t.usd)}</span>
                    <span className={cn("num font-bold", hot ? "text-bear" : "text-muted-foreground")}>
                      {t.risk}/100
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded bg-secondary">
                    <div
                      className={cn("h-full", hot ? "bg-bear" : "bg-primary")}
                      style={{ width: `${(age / CONFIRM_MS) * 100}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Peak {fmtUsd(t.peakUsd)} · {Math.round(age / 1000)}s watched
                    {hot ? " · SPOOF SUSPECT — size being pulled" : ""}
                  </p>
                </div>
              );
            })}
            {!tracking.length && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No walls above {fmtUsd(minUsd)} yet — radar is live, lower the size filter to catch more.
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
                    {c.status !== "filled" && (
                      <span
                        className={cn(
                          "num rounded border px-1.5 py-0.5 font-bold",
                          c.confidence >= HIGH_RISK
                            ? "border-bear/60 bg-bear/15 text-bear"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {c.confidence}/100
                      </span>
                    )}
                    <span className="num">{fmtPrice(c.price)}</span>
                    <span className="num">{fmtUsd(c.peakUsd)}</span>
                  </div>
                  {c.status === "spoof" && (
                    <p className="mt-1 text-muted-foreground">
                      {c.confidence >= HIGH_RISK ? "HIGH CONFIDENCE · " : ""}
                      {fmtUsd(c.cancelledUsd)} cancelled ·{" "}
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

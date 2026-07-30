import { useMemo, useState } from "react";
import { INTERVALS, type Interval } from "@/lib/binance";
import { useTopSymbols } from "@/hooks/useMarket";
import { cn } from "@/lib/utils";

/** Symbol + timeframe selector backed by the live top-200 Binance volume list. */
export function SymbolPicker({
  symbol,
  setSymbol,
  interval,
  setInterval,
  showInterval = true,
}: {
  symbol: string;
  setSymbol: (s: string) => void;
  interval?: Interval;
  setInterval?: (i: Interval) => void;
  showInterval?: boolean;
}) {
  const { tickers } = useTopSymbols(200);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const list = useMemo(() => {
    const base = tickers.length ? tickers : [{ symbol, price: 0, changePct: 0, quoteVolume: 0 }];
    const withGold = [
      ...base,
      { symbol: "XAUUSD", price: 0, changePct: 0, quoteVolume: 0 },
    ];
    return withGold.filter((t) => t.symbol.includes(q.toUpperCase())).slice(0, 120);
  }, [tickers, q, symbol]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="num rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary"
        >
          {symbol} ▾
        </button>
        {open && (
          <div className="panel absolute z-50 mt-2 max-h-80 w-64 overflow-auto p-2 scroll-lock">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search 200+ symbols…"
              className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-sm outline-none"
            />
            {list.map((t) => (
              <button
                key={t.symbol}
                onClick={() => {
                  setSymbol(t.symbol);
                  setOpen(false);
                  setQ("");
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-secondary",
                  t.symbol === symbol && "bg-secondary",
                )}
              >
                <span className="num">{t.symbol}</span>
                <span
                  className={cn(
                    "num",
                    t.changePct >= 0 ? "text-bull" : "text-bear",
                  )}
                >
                  {t.changePct ? `${t.changePct.toFixed(2)}%` : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {showInterval && interval && setInterval && (
        <div className="flex flex-wrap gap-1">
          {INTERVALS.map((i) => (
            <button
              key={i}
              onClick={() => setInterval(i)}
              className={cn(
                "num rounded border border-border px-2 py-1 text-xs",
                i === interval ? "border-primary/60 bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {i}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

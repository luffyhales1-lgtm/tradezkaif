import { useEffect, useMemo, useState } from "react";
import { CandleChart, type ChartLine } from "@/components/CandleChart";
import { useCandles } from "@/hooks/useMarket";
import { fmtPrice, type Interval } from "@/lib/binance";
import { Pill } from "@/components/ui-bits";
import { cn } from "@/lib/utils";

type Props = {
  symbol: string;
  interval: Interval;
  bias: "long" | "short";
  entry: number;
  stop: number;
  targets: number[];
  fmt?: (n: number) => string;
  height?: number;
};

/**
 * Medium live screener attached to every published setup: streams the same
 * candles as the terminal, plots entry / SL / TP and closes itself once the
 * final target or the stop is tagged.
 */
export function SignalScreener({
  symbol,
  interval,
  bias,
  entry,
  stop,
  targets,
  fmt = fmtPrice,
  height = 260,
}: Props) {
  const { candles } = useCandles(symbol, interval, 240);
  const [status, setStatus] = useState<"live" | "tp" | "sl">("live");
  const last = candles.at(-1)?.c ?? entry;
  const finalTp = targets.at(-1) ?? entry;

  useEffect(() => {
    if (status !== "live" || !candles.length) return;
    const c = candles.at(-1)!;
    const hitSl = bias === "long" ? c.l <= stop : c.h >= stop;
    const hitTp = bias === "long" ? c.h >= finalTp : c.l <= finalTp;
    if (hitSl) setStatus("sl");
    else if (hitTp) setStatus("tp");
  }, [candles, bias, stop, finalTp, status]);

  const lines = useMemo<ChartLine[]>(
    () => [
      { price: entry, color: "#60a5fa", label: `Entry ${fmt(entry)}`, group: bias },
      { price: stop, color: "#f43f5e", label: `SL ${fmt(stop)}`, dashed: true, group: bias },
      ...targets.map((t, i) => ({
        price: t,
        color: "#22c55e",
        label: `TP${i + 1} ${fmt(t)}`,
        dashed: true,
        group: bias as ChartLine["group"],
      })),
    ],
    [entry, stop, targets, bias, fmt],
  );

  const move = bias === "long" ? (last - entry) / entry : (entry - last) / entry;

  return (
    <div className="mt-3 rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5 text-[11px]">
        <Pill tone={status === "tp" ? "bull" : status === "sl" ? "bear" : "primary"}>
          {status === "live" ? "live screener" : status === "tp" ? "all TP hit · closed" : "SL hit · closed"}
        </Pill>
        <span className="num text-muted-foreground">
          mark {fmt(last)}
        </span>
        <span className={cn("num", move >= 0 ? "text-bull" : "text-bear")}>
          {move >= 0 ? "+" : ""}
          {(move * 100).toFixed(2)}%
        </span>
        <span className="ml-auto num text-muted-foreground">{symbol} · {interval}</span>
      </div>
      <CandleChart candles={candles} lines={lines} height={height} symbol={symbol} />
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { SymbolPicker } from "@/components/SymbolPicker";
import { Panel, Pill, Stat } from "@/components/ui-bits";
import { useBook, useCandles, useMarkPrice, useSymbolState } from "@/hooks/useMarket";
import { analyze } from "@/lib/analysis";
import { fmtPrice, fmtUsd } from "@/lib/binance";

export const Route = createFileRoute("/summary")({
  head: () => ({
    meta: [
      { title: "Market Summary — CoTraders" },
      {
        name: "description",
        content: "One-screen read of trend, order flow, liquidity and structure with a plain-language action plan.",
      },
      { property: "og:title", content: "Market Summary — CoTraders" },
      { property: "og:description", content: "What is happening right now and what to do about it." },
    ],
  }),
  component: Summary,
});

function Summary() {
  const { symbol, setSymbol, interval, setInterval } = useSymbolState();
  const { candles } = useCandles(symbol, interval, 400);
  const book = useBook(symbol);
  const mark = useMarkPrice(symbol);
  const closedKey = candles.length ? candles.at(-1)!.t : 0;

  const a = useMemo(
    () => (candles.length > 200 ? analyze(symbol, candles, interval, book) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol, interval, closedKey, candles.length > 200, book?.ts ? Math.floor(book.ts / 15000) : 0],
  );

  if (!a) {
    return (
      <div className="space-y-4">
        <SymbolPicker symbol={symbol} setSymbol={setSymbol} interval={interval} setInterval={setInterval} />
        <Panel><p className="text-sm text-muted-foreground">Reading the market…</p></Panel>
      </div>
    );
  }

  const bull = a.signal.bias === "long";
  const nearest = a.sr[0];
  const sweep = a.liq.find((z) => z.kind === "sweep");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SymbolPicker symbol={symbol} setSymbol={setSymbol} interval={interval} setInterval={setInterval} />
        <div className="flex items-center gap-2">
          <span className="num text-xl font-bold">{mark ? fmtPrice(mark) : fmtPrice(a.price)}</span>
          <Pill tone={bull ? "bull" : a.signal.bias === "short" ? "bear" : "default"}>
            {a.signal.bias} · {a.signal.probability}%
          </Pill>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="RSI(14)" value={a.rsi.toFixed(1)} tone={a.rsi > 60 ? "bull" : a.rsi < 40 ? "bear" : "default"} />
        <Stat label="EMA21 vs 50" value={a.ema.e21 > a.ema.e50 ? "Bullish" : "Bearish"} tone={a.ema.e21 > a.ema.e50 ? "bull" : "bear"} />
        <Stat label="Delta bias" value={`${(a.deltaRatio * 100).toFixed(1)}%`} tone={a.deltaRatio >= 0 ? "bull" : "bear"} />
        <Stat
          label="Book imbalance"
          value={a.book ? `${(a.book.imbalance * 100).toFixed(1)}%` : "—"}
          tone={(a.book?.imbalance ?? 0) >= 0 ? "bull" : "bear"}
        />
        <Stat label="ATR" value={fmtPrice(a.atr)} hint="volatility unit" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="What is happening right now">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              • Trend: EMA21 {a.ema.e21 > a.ema.e50 ? "above" : "below"} EMA50 and price{" "}
              {a.price > a.ema.e200 ? "above" : "below"} EMA200 — {bull ? "buyers" : "sellers"} own the structure on{" "}
              {interval}.
            </li>
            <li>
              • Order flow: net taker delta is {(a.deltaRatio * 100).toFixed(1)}% over the last 12 candles
              {a.book ? `, book is ${a.book.imbalance >= 0 ? "bid" : "ask"} heavy` : ""}.
            </li>
            <li>
              • Structure: nearest level is {nearest ? `${nearest.label} at ${fmtPrice((nearest.low + nearest.high) / 2)}` : "not defined yet"}.
            </li>
            <li>
              • Liquidity: {sweep ? `a sweep already fired at ${fmtPrice((sweep.low + sweep.high) / 2)} — reversal risk` : "no sweep yet; resting pools still intact"}.
            </li>
            {a.book && (
              <li>• Depth: {fmtUsd(a.book.bidUsd)} bid vs {fmtUsd(a.book.askUsd)} ask within the visible book.</li>
            )}
          </ul>
        </Panel>

        <Panel title="What you can do">
          <div className="space-y-2">
            <Stat label="Preferred side" value={a.signal.bias.toUpperCase()} tone={bull ? "bull" : "bear"} />
            <Stat label="Entry" value={fmtPrice(a.signal.entry)} />
            <Stat label="Stop" value={fmtPrice(a.signal.stop)} tone="bear" />
            <div className="grid grid-cols-3 gap-2">
              {a.signal.targets.map((t, i) => (
                <Stat key={i} label={`TP${i + 1}`} value={fmtPrice(t)} tone="bull" />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {a.signal.probability >= 70
                ? "Confluence is strong — a standard-size entry is reasonable with the stop above."
                : "Confluence is mixed — either wait for the next candle close or halve your size."}
            </p>
          </div>
        </Panel>
      </div>

      <Panel title="Confluence breakdown">
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {a.signal.confluence.map((c) => (
            <div key={c.label} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{c.label}</span>
                <Pill tone={c.bias === "long" ? "bull" : c.bias === "short" ? "bear" : "default"}>{c.bias}</Pill>
              </div>
              <p className="num mt-1 text-xs text-muted-foreground">{c.detail}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

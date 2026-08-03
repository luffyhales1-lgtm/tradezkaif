/**
 * Global background detection engine.
 *
 * Mounted once in the app shell so the Live Log keeps receiving spoof,
 * whale-wall, liquidity-sweep and big-print events even when the user is not
 * standing on the page that owns that detector.
 */
import { useEffect, useRef } from "react";
import { useBook, useCandles, useMarkPrice, useSymbolState, useTrades } from "@/hooks/useMarket";
import { useSpoofRadar } from "@/hooks/useSpoof";
import { bookAnalysis, liquidityZones } from "@/lib/analysis";
import { fmtPrice, fmtUsd } from "@/lib/binance";
import { pushLog } from "@/lib/bus";

export function useLiveEngine() {
  const { symbol } = useSymbolState();
  const book = useBook(symbol, 500);
  const price = useMarkPrice(symbol);
  const { trades } = useTrades(symbol, 100_000, 60);
  const { candles } = useCandles(symbol, "1m", 200);

  // Spoof radar runs globally — its own hook pushes SPOOF/REAL WALL entries.
  useSpoofRadar(symbol, book, price, 250_000);

  const seenTrade = useRef(new Set<string>());
  const seenWall = useRef(new Set<string>());
  const seenSweep = useRef(new Set<string>());
  const lastBar = useRef(0);

  useEffect(() => {
    seenTrade.current.clear();
    seenWall.current.clear();
    seenSweep.current.clear();
    lastBar.current = 0;
    pushLog({ kind: "system", symbol, text: `Live engine attached to ${symbol}`, meta: "spoof · whales · sweeps · prints" });
  }, [symbol]);

  // Whale prints
  useEffect(() => {
    trades.slice(0, 8).forEach((t) => {
      const id = `${t.ts}-${t.price}-${t.qty}`;
      if (seenTrade.current.has(id)) return;
      seenTrade.current.add(id);
      pushLog({
        kind: "flow",
        symbol,
        text: `${t.buyerMaker ? "SELL" : "BUY"} print ${fmtUsd(t.usd)} @ ${fmtPrice(t.price)}`,
        meta: `${t.qty.toFixed(3)} contracts · aggressive ${t.buyerMaker ? "seller" : "buyer"}`,
      });
    });
    if (seenTrade.current.size > 800) seenTrade.current.clear();
  }, [trades, symbol]);

  // Fresh whale walls appearing in the book
  useEffect(() => {
    const ba = bookAnalysis(book, 1_000_000);
    ba?.walls.slice(0, 6).forEach((w) => {
      const id = `${w.side}:${w.price}`;
      if (seenWall.current.has(id)) return;
      seenWall.current.add(id);
      pushLog({
        kind: "whale",
        symbol,
        text: `Whale ${w.side === "bid" ? "BID" : "ASK"} wall ${fmtUsd(w.usd)} @ ${fmtPrice(w.price)}`,
        meta: `${w.side === "bid" ? "support" : "resistance"} candidate · under 30s spoof watch`,
      });
    });
    if (seenWall.current.size > 400) seenWall.current.clear();
  }, [book, symbol]);

  // Liquidity sweeps, recomputed only when a 1m candle closes
  useEffect(() => {
    const last = candles.at(-1);
    if (!last || candles.length < 60 || last.t === lastBar.current) return;
    lastBar.current = last.t;
    liquidityZones(candles)
      .filter((z) => z.kind === "sweep")
      .slice(0, 3)
      .forEach((z) => {
        const id = `${z.low.toFixed(6)}-${z.high.toFixed(6)}`;
        if (seenSweep.current.has(id)) return;
        seenSweep.current.add(id);
        pushLog({
          kind: "sweep",
          symbol,
          text: `LIQUIDITY SWEPT · ${z.label}`,
          meta: `${fmtPrice(z.low)} – ${fmtPrice(z.high)} · reversal watch on retest`,
        });
      });
    if (seenSweep.current.size > 200) seenSweep.current.clear();
  }, [candles, symbol]);
}

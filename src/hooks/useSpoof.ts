/**
 * Spoof radar: watches large resting walls for a 30s confirmation window.
 * A wall that is pulled before price reaches it is classified as spoof,
 * a wall that price actually trades into is classified as real (filled).
 */
import { useEffect, useRef, useState } from "react";
import type { Book } from "@/lib/binance";
import { pushLog } from "@/lib/bus";

export type WallTrack = {
  id: string;
  side: "bid" | "ask";
  price: number;
  peakUsd: number;
  usd: number;
  firstSeen: number;
  lastSeen: number;
  status: "tracking" | "spoof" | "real" | "filled";
  confidence: number;
  cancelledUsd: number;
  /** Live 0-100 spoof risk while the wall is still being watched. */
  risk: number;
};

export const CONFIRM_MS = 30_000;
export const HIGH_RISK = 70;

/** Live spoof-risk score for a wall that has not finished its 30s window. */
function liveRisk(t: WallTrack, price: number, minUsd: number, now: number) {
  const shrink = t.peakUsd > 0 ? 1 - t.usd / t.peakUsd : 0; // wall being pulled down
  const size = Math.min(1, t.peakUsd / (minUsd * 4)); // oversized = attention grabbing
  const dist = price > 0 ? Math.min(1, (Math.abs(t.price - price) / price) * 120) : 0;
  const age = Math.min(1, (now - t.firstSeen) / CONFIRM_MS);
  return Math.round(Math.min(99, shrink * 55 + size * 22 + dist * 15 + age * 8));
}


export function useSpoofRadar(
  symbol: string,
  book: Book | null,
  price: number,
  minUsd = 1_000_000,
) {
  const tracks = useRef(new Map<string, WallTrack>());
  const [list, setList] = useState<WallTrack[]>([]);
  const [confirmed, setConfirmed] = useState<WallTrack[]>([]);

  useEffect(() => {
    tracks.current.clear();
    setList([]);
    setConfirmed([]);
  }, [symbol]);

  useEffect(() => {
    if (!book) return;
    const now = Date.now();
    const seen = new Set<string>();
    const consider = (levels: Book["bids"], side: "bid" | "ask") => {
      levels
        .filter((l) => l.usd >= minUsd)
        .slice(0, 25)
        .forEach((l) => {
          const id = `${side}:${l.price}`;
          seen.add(id);
          const t = tracks.current.get(id);
          if (t) {
            t.usd = l.usd;
            t.peakUsd = Math.max(t.peakUsd, l.usd);
            t.lastSeen = now;
          } else {
            tracks.current.set(id, {
              id,
              side,
              price: l.price,
              usd: l.usd,
              peakUsd: l.usd,
              firstSeen: now,
              lastSeen: now,
              status: "tracking",
              confidence: 0,
              cancelledUsd: 0,
            });
          }
        });
    };
    consider(book.bids, "bid");
    consider(book.asks, "ask");

    const newlyConfirmed: WallTrack[] = [];
    tracks.current.forEach((t, id) => {
      const age = now - t.firstSeen;
      const gone = !seen.has(id) && now - t.lastSeen > 1200;
      const touched =
        price > 0 &&
        (t.side === "bid" ? price <= t.price * 1.0002 : price >= t.price * 0.9998);

      if (t.status === "tracking" && touched) {
        t.status = "filled";
        t.confidence = 0;
        newlyConfirmed.push({ ...t });
        tracks.current.delete(id);
        return;
      }
      if (t.status === "tracking" && gone) {
        if (age >= CONFIRM_MS) {
          const dist = Math.abs(t.price - price) / (price || 1);
          t.status = "spoof";
          t.cancelledUsd = t.peakUsd;
          t.confidence = Math.min(
            100,
            Math.round(60 + Math.min(30, (t.peakUsd / minUsd) * 12) + Math.min(10, dist * 900)),
          );
          newlyConfirmed.push({ ...t });
          pushLog({
            kind: "spoof",
            symbol,
            text: `SPOOF CONFIRMED · ${t.side === "bid" ? "Bid" : "Ask"} wall @ ${t.price} pulled`,
            meta: `${t.confidence}/100 confidence · $${(t.peakUsd / 1e6).toFixed(2)}M cancelled after ${(age / 1000).toFixed(0)}s`,
          });
        }
          tracks.current.delete(id);
        return;
      }
      if (t.status === "tracking" && age >= CONFIRM_MS && seen.has(id)) {
        t.status = "real";
        t.confidence = Math.min(100, Math.round(55 + (t.peakUsd / minUsd) * 15));
        newlyConfirmed.push({ ...t });
        pushLog({
          kind: "whale",
          symbol,
          text: `REAL WALL · ${t.side === "bid" ? "Bid" : "Ask"} @ ${t.price} held 30s`,
          meta: `$${(t.usd / 1e6).toFixed(2)}M resting`,
        });
      }
      if (now - t.lastSeen > 120_000) tracks.current.delete(id);
    });

    setList([...tracks.current.values()].sort((a, b) => b.peakUsd - a.peakUsd).slice(0, 20));
    if (newlyConfirmed.length) {
      setConfirmed((prev) => [...newlyConfirmed, ...prev].slice(0, 40));
    }
  }, [book, price, minUsd, symbol]);

  const spoofPct = (() => {
    const recent = confirmed.slice(0, 20);
    if (!recent.length) return 0;
    const spoofs = recent.filter((r) => r.status === "spoof").length;
    return Math.round((spoofs / recent.length) * 100);
  })();

  return { tracking: list, confirmed, spoofPct };
}

/** 30s cyclic countdown used by the radar clock. */
export function useCountdown(seconds = 30) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const id = setInterval(() => setLeft((l) => (l <= 1 ? seconds : l - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return left;
}

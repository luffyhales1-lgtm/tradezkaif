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
  flagged?: boolean;

};

export const CONFIRM_MS = 30_000;
export const HIGH_RISK = 70;

/** Live spoof-risk score for a wall that has not finished its 30s window. */
function liveRisk(t: WallTrack, price: number, minUsd: number, now: number) {
  const shrink = t.peakUsd > 0 ? Math.max(0, 1 - t.usd / t.peakUsd) : 0; // wall being pulled down
  const size = Math.min(1, t.peakUsd / (minUsd * 2.5)); // oversized = attention grabbing
  const dist = price > 0 ? Math.min(1, (Math.abs(t.price - price) / price) * 160) : 0;
  const age = Math.min(1, (now - t.firstSeen) / CONFIRM_MS);
  // A wall that is visibly being pulled while price never came close is the
  // textbook spoof: that combination alone drives the score into the 90s.
  const raw = shrink * 62 + size * 18 + dist * 14 + age * 8;
  const combo = shrink > 0.5 && dist > 0.35 ? 8 : 0;
  return Math.round(Math.min(99, raw + combo));
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
              risk: 0,
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
      t.risk = liveRisk(t, price, minUsd, now);

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
          // Fully cancelled, never-touched walls score in the high 90s.
          t.confidence = Math.min(
            99,
            Math.round(
              72 +
                Math.min(14, (t.peakUsd / minUsd) * 7) +
                Math.min(8, dist * 800) +
                Math.min(5, (age / CONFIRM_MS) * 5),
            ),
          );
          newlyConfirmed.push({ ...t });
          pushLog({
            kind: "spoof",
            symbol,
            text: `SPOOF CONFIRMED ${t.confidence}/100 · ${t.side === "bid" ? "Bid" : "Ask"} wall @ ${t.price} pulled`,
            meta: `${t.confidence >= HIGH_RISK ? "HIGH RISK · " : ""}$${(t.peakUsd / 1e6).toFixed(2)}M cancelled after ${(age / 1000).toFixed(0)}s`,
          });
        }
        tracks.current.delete(id);
        return;
      }
      if (t.status === "tracking" && t.risk >= HIGH_RISK && !t.flagged) {
        t.flagged = true;
        pushLog({
          kind: "spoof",
          symbol,
          text: `SPOOF RISK ${t.risk}/100 · ${t.side === "bid" ? "Bid" : "Ask"} wall @ ${t.price} shrinking`,
          meta: `$${(t.peakUsd / 1e6).toFixed(2)}M peak → $${(t.usd / 1e6).toFixed(2)}M now · verdict in ${Math.max(0, Math.round((CONFIRM_MS - age) / 1000))}s`,
        });
      }
      if (t.status === "tracking" && age >= CONFIRM_MS && seen.has(id)) {
        t.status = "real";
        t.confidence = Math.min(99, Math.round(70 + (t.peakUsd / minUsd) * 10));
        newlyConfirmed.push({ ...t });
        pushLog({
          kind: "whale",
          symbol,
          text: `REAL WALL ${t.confidence}/100 · ${t.side === "bid" ? "Bid" : "Ask"} @ ${t.price} held 30s`,
          meta: `$${(t.usd / 1e6).toFixed(2)}M resting`,
        });
      }
      if (now - t.lastSeen > 120_000) tracks.current.delete(id);
    });

    setList([...tracks.current.values()].sort((a, b) => b.risk - a.risk || b.peakUsd - a.peakUsd).slice(0, 20));

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

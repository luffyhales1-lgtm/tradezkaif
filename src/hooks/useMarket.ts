import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDepth,
  fetchKlines,
  fetchTopSymbols,
  openStream,
  type Book,
  type Candle,
  type Interval,
  type StreamStats,
  type Ticker,
  type Trade,
  FALLBACK_SYMBOLS,
} from "@/lib/binance";

/** Repaint budget: coalesce socket bursts into animation frames. */
function useThrottledState<T>(initial: T, ms = 100) {
  const [state, setState] = useState(initial);
  const pending = useRef<T | null>(null);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback(
    (v: T) => {
      pending.current = v;
      const now = performance.now();
      if (now - last.current >= ms) {
        last.current = now;
        setState(v);
        return;
      }
      if (timer.current) return;
      timer.current = setTimeout(
        () => {
          timer.current = null;
          last.current = performance.now();
          if (pending.current !== null) setState(pending.current);
        },
        ms - (now - last.current),
      );
    },
    [ms],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return [state, push] as const;
}

export function useTopSymbols(limit = 200) {
  const [tickers, setTickers] = useState<Ticker[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchTopSymbols(limit)
      .then((t) => {
        setTickers(t);
        setError(null);
      })
      .catch((e: Error) => {
        setError(e.message);
        setTickers(
          FALLBACK_SYMBOLS.map((s) => ({
            symbol: s,
            price: 0,
            changePct: 0,
            quoteVolume: 0,
          })),
        );
      });
  }, [limit]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return { tickers, error, reload: load };
}

/** Live candles: REST seed + kline websocket, updating in place. */
export function useCandles(symbol: string, interval: Interval, limit = 400) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [live, pushLive] = useThrottledState<Candle[]>([], 250);
  const ref = useRef<Candle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchKlines(symbol, interval, limit)
      .then((c) => {
        if (!alive) return;
        ref.current = c;
        setCandles(c);
        pushLive(c);
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbol, interval, limit, pushLive]);

  useEffect(() => {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    return openStream([stream], (_s, data) => {
      const k = data.k as Record<string, string | number | boolean>;
      const c: Candle = {
        t: Number(k.t),
        o: Number(k.o),
        h: Number(k.h),
        l: Number(k.l),
        c: Number(k.c),
        v: Number(k.v),
        buyV: Number(k.V),
        trades: Number(k.n),
        closed: Boolean(k.x),
      };
      const arr = ref.current.slice();
      const last = arr[arr.length - 1];
      if (last && last.t === c.t) arr[arr.length - 1] = c;
      else arr.push(c);
      ref.current = arr.slice(-limit);
      pushLive(ref.current);
    });
  }, [symbol, interval, limit, pushLive]);

  return { candles: live.length ? live : candles, loading };
}

/**
 * Aggregated trade tape (order-flow prints).
 * The socket keeps a raw ring buffer; the size filter is applied at render
 * time so changing "min size" never tears down the live feed.
 */
export function useTrades(symbol: string, minUsd = 0, cap = 300) {
  const [tape, push] = useThrottledState<Trade[]>([], 120);
  const ref = useRef<Trade[]>([]);
  const [stats, setStats] = useState<StreamStats | null>(null);

  useEffect(() => {
    ref.current = [];
    push([]);
    return subscribe(
      [`${symbol.toLowerCase()}@aggTrade`],
      (_s, d) => {
        const price = Number(d.p);
        const qty = Number(d.q);
        if (!price || !qty) return;
        const t: Trade = {
          ts: Number(d.T),
          price,
          qty,
          usd: price * qty,
          buyerMaker: Boolean(d.m),
        };
        const buf = ref.current;
        buf.unshift(t);
        if (buf.length > 3000) buf.length = 3000;
        push(buf.slice(0, 1200));
      },
      setStats,
    );
  }, [symbol, push]);

  const trades = useMemo(
    () => (minUsd > 0 ? tape.filter((t) => t.usd >= minUsd) : tape).slice(0, cap),
    [tape, minUsd, cap],
  );

  return { trades, tape, stats };
}


/** Order book snapshot refreshed by the diff stream. */
export function useBook(symbol: string, depth = 500) {
  const [book, push] = useThrottledState<Book | null>(null, 450);
  const ref = useRef<Map<number, number>[]>([new Map(), new Map()]);

  useEffect(() => {
    let alive = true;
    const seed = () =>
      fetchDepth(symbol, depth)
        .then((b) => {
          if (!alive) return;
          ref.current = [
            new Map(b.bids.map((l) => [l.price, l.qty])),
            new Map(b.asks.map((l) => [l.price, l.qty])),
          ];
          push(b);
        })
        .catch(() => undefined);
    seed();
    const reseed = setInterval(seed, 20_000);

    const close = openStream([`${symbol.toLowerCase()}@depth@500ms`], (_s, d) => {
      const [bids, asks] = ref.current;
      const apply = (m: Map<number, number>, rows: string[][]) => {
        rows.forEach(([p, q]) => {
          const price = Number(p);
          const qty = Number(q);
          if (qty === 0) m.delete(price);
          else m.set(price, qty);
        });
      };
      apply(bids, (d.b as string[][]) ?? []);
      apply(asks, (d.a as string[][]) ?? []);
      const toLevels = (m: Map<number, number>, desc: boolean) =>
        [...m.entries()]
          .map(([price, qty]) => ({ price, qty, usd: price * qty }))
          .sort((x, y) => (desc ? y.price - x.price : x.price - y.price))
          .slice(0, 200);
      push({ bids: toLevels(bids, true), asks: toLevels(asks, false), ts: Date.now() });
    });

    return () => {
      alive = false;
      clearInterval(reseed);
      close();
    };
  }, [symbol, depth, push]);

  return book;
}

export function useMarkPrice(symbol: string) {
  const [price, push] = useThrottledState<number>(0, 400);
  useEffect(
    () =>
      openStream([`${symbol.toLowerCase()}@markPrice@1s`], (_s, d) => push(Number(d.p))),
    [symbol, push],
  );
  return price;
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value, hydrated]);

  return [value, setValue, hydrated] as const;
}

export function useSymbolState(defaultSymbol = "BTCUSDT") {
  const [symbol, setSymbol] = useLocalState("cotraders.symbol", defaultSymbol);
  const [interval, setInterval_] = useLocalState<Interval>("cotraders.interval", "5m");
  return useMemo(
    () => ({ symbol, setSymbol, interval, setInterval: setInterval_ }),
    [symbol, setSymbol, interval, setInterval_],
  );
}

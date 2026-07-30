/** Binance USDⓈ-M futures market data (REST + WebSocket) with reconnect + throttling. */

export const REST = "https://fapi.binance.com";
export const WS = "wss://fstream.binance.com/stream?streams=";

export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  buyV: number;
  trades: number;
  closed: boolean;
};

export type Trade = {
  ts: number;
  price: number;
  qty: number;
  usd: number;
  buyerMaker: boolean;
};

export type DepthLevel = { price: number; qty: number; usd: number };
export type Book = { bids: DepthLevel[]; asks: DepthLevel[]; ts: number };

export const INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export type Interval = (typeof INTERVALS)[number];

export const FALLBACK_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT",
  "AVAXUSDT", "LINKUSDT", "TONUSDT", "TRXUSDT", "DOTUSDT", "NEARUSDT", "LTCUSDT",
  "SUIUSDT", "APTUSDT", "OPUSDT", "ARBUSDT", "INJUSDT", "SEIUSDT",
];

export type Ticker = {
  symbol: string;
  price: number;
  changePct: number;
  quoteVolume: number;
};

/** Top N symbols ranked by 24h quote volume (high-volume only, never dead coins). */
export async function fetchTopSymbols(limit = 200): Promise<Ticker[]> {
  const res = await fetch(`${REST}/fapi/v1/ticker/24hr`);
  if (!res.ok) throw new Error(`ticker ${res.status}`);
  const raw = (await res.json()) as Array<Record<string, string>>;
  return raw
    .filter((r) => r.symbol.endsWith("USDT") && Number(r.quoteVolume) > 5_000_000)
    .map((r) => ({
      symbol: r.symbol,
      price: Number(r.lastPrice),
      changePct: Number(r.priceChangePercent),
      quoteVolume: Number(r.quoteVolume),
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, limit);
}

export async function fetchKlines(
  symbol: string,
  interval: Interval,
  limit = 500,
): Promise<Candle[]> {
  const res = await fetch(
    `${REST}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`klines ${res.status}`);
  const raw = (await res.json()) as unknown[][];
  return raw.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
    buyV: Number(k[9]),
    trades: Number(k[8]),
    closed: true,
  }));
}

export async function fetchDepth(symbol: string, limit = 500): Promise<Book> {
  const res = await fetch(`${REST}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`);
  if (!res.ok) throw new Error(`depth ${res.status}`);
  const raw = (await res.json()) as { bids: string[][]; asks: string[][] };
  const map = (rows: string[][]) =>
    rows.map(([p, q]) => ({
      price: Number(p),
      qty: Number(q),
      usd: Number(p) * Number(q),
    }));
  return { bids: map(raw.bids), asks: map(raw.asks), ts: Date.now() };
}

export type StreamStatus = "connecting" | "open" | "closed";

export type StreamStats = {
  status: StreamStatus;
  lastMsgAt: number;
  messages: number;
  dropped: number;
  reconnects: number;
};

/**
 * Single multiplexed socket with exponential-backoff reconnect and a
 * frame budget so the UI never stalls under heavy order flow.
 */
export function openStream(
  streams: string[],
  onMessage: (stream: string, data: Record<string, unknown>) => void,
  onStats?: (s: StreamStats) => void,
) {
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stats: StreamStats = {
    status: "connecting",
    lastMsgAt: 0,
    messages: 0,
    dropped: 0,
    reconnects: 0,
  };
  const emit = () => onStats?.({ ...stats });

  const connect = () => {
    if (closedByUser) return;
    stats.status = "connecting";
    emit();
    ws = new WebSocket(WS + streams.join("/"));
    ws.onopen = () => {
      attempt = 0;
      stats.status = "open";
      emit();
    };
    ws.onmessage = (ev) => {
      stats.messages++;
      stats.lastMsgAt = Date.now();
      try {
        const parsed = JSON.parse(ev.data as string) as {
          stream: string;
          data: Record<string, unknown>;
        };
        onMessage(parsed.stream, parsed.data);
      } catch {
        stats.dropped++;
      }
    };
    ws.onerror = () => ws?.close();
    ws.onclose = () => {
      if (closedByUser) return;
      stats.status = "closed";
      stats.reconnects++;
      emit();
      attempt = Math.min(attempt + 1, 6);
      timer = setTimeout(connect, Math.min(500 * 2 ** attempt, 8000));
    };
  };

  connect();

  return () => {
    closedByUser = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}

export const fmtUsd = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};

export const fmtPrice = (n: number) =>
  n >= 1000 ? n.toFixed(1) : n >= 1 ? n.toFixed(3) : n.toFixed(6);

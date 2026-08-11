/** Always-on background backtest engine.
 * Starts automatically when the site opens, keeps replaying the current
 * Ultimate scanner presets over recent candles until the tab is closed. */
import { fetchKlines, fetchTopSymbols, type Interval } from "@/lib/binance";
import { replaySymbol, summarise, type ReplayStats, type ReplayTrade } from "@/lib/backtest";
import { defaultScannerSettings, type ScannerSettings } from "@/lib/scanner-settings";

export type BacktestState = {
  running: boolean;
  startedAt: number | null;
  cycle: number;
  symbolsDone: number;
  symbolsTotal: number;
  current: string | null;
  interval: Interval;
  settings: ScannerSettings;
  trades: ReplayTrade[];
  stats: ReplayStats;
  error: string | null;
  updatedAt: number;
};

const MAX_TRADES = 1200;

function ultimateSettings(): ScannerSettings {
  const base = defaultScannerSettings(75);
  if (typeof window === "undefined") return base;
  try {
    const saved = window.localStorage.getItem("cotraders.scanner.ultimate");
    return saved ? { ...base, ...(JSON.parse(saved) as Partial<ScannerSettings>) } : base;
  } catch {
    return base;
  }
}

let state: BacktestState = {
  running: false,
  startedAt: null,
  cycle: 0,
  symbolsDone: 0,
  symbolsTotal: 0,
  current: null,
  interval: "15m",
  settings: defaultScannerSettings(75),
  trades: [],
  stats: summarise([]),
  error: null,
  updatedAt: Date.now(),
};

const listeners = new Set<(s: BacktestState) => void>();
let loopActive = false;

function emit(patch: Partial<BacktestState>) {
  state = { ...state, ...patch, updatedAt: Date.now() };
  listeners.forEach((fn) => fn(state));
}

export const getBacktestState = () => state;

export function subscribeBacktest(fn: (s: BacktestState) => void) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function setBacktestInterval(interval: Interval) {
  emit({ interval });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop() {
  while (loopActive) {
    try {
      const settings = ultimateSettings();
      const symbols = (await fetchTopSymbols(60)).map((t) => t.symbol);
      emit({ settings, symbolsTotal: symbols.length, symbolsDone: 0, error: null });
      const fresh: ReplayTrade[] = [];
      for (const symbol of symbols) {
        if (!loopActive) return;
        emit({ current: symbol });
        try {
          const candles = await fetchKlines(symbol, state.interval, 500);
          fresh.push(...replaySymbol(symbol, candles, state.interval, settings));
        } catch {
          /* skip symbol, keep the engine alive */
        }
        const merged = [...fresh, ...state.trades].slice(0, MAX_TRADES);
        emit({
          symbolsDone: state.symbolsDone + 1,
          trades: merged,
          stats: summarise(merged),
        });
        await sleep(120);
      }
      emit({ cycle: state.cycle + 1, current: null });
      await sleep(20_000);
    } catch (e) {
      emit({ error: (e as Error).message, current: null });
      await sleep(15_000);
    }
  }
}

export function startBacktestEngine() {
  if (loopActive || typeof window === "undefined") return;
  loopActive = true;
  emit({ running: true, startedAt: state.startedAt ?? Date.now() });
  void loop();
}

export function stopBacktestEngine() {
  loopActive = false;
  emit({ running: false, current: null });
}

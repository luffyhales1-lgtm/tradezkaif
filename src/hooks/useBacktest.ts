import { useEffect, useState } from "react";
import {
  getBacktestState,
  startBacktestEngine,
  subscribeBacktest,
  type BacktestState,
} from "@/lib/backtest-engine";

/** Subscribes to the always-on background replay engine (auto-starts it). */
export function useBacktest(autoStart = true) {
  const [state, setState] = useState<BacktestState>(() => getBacktestState());
  useEffect(() => {
    if (autoStart) startBacktestEngine();
    const unsubscribe = subscribeBacktest(setState);
    return () => {
      unsubscribe();
    };
  }, [autoStart]);
  return state;
}

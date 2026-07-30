/** Lightweight pub/sub for live market log events shared across pages. */
export type LogKind =
  | "spoof"
  | "flow"
  | "sweep"
  | "signal"
  | "whale"
  | "paper"
  | "alert"
  | "system";

export type LogEvent = {
  id: string;
  ts: number;
  kind: LogKind;
  symbol: string;
  text: string;
  meta?: string;
};

const MAX = 400;
let events: LogEvent[] = [];
const listeners = new Set<(e: LogEvent[]) => void>();
let seq = 0;

export function pushLog(e: Omit<LogEvent, "id" | "ts"> & { ts?: number }) {
  const ev: LogEvent = { id: `${Date.now()}-${seq++}`, ts: e.ts ?? Date.now(), ...e };
  events = [ev, ...events].slice(0, MAX);
  listeners.forEach((l) => l(events));
  return ev;
}

export function getLogs() {
  return events;
}

export function subscribeLogs(fn: (e: LogEvent[]) => void) {
  listeners.add(fn);
  fn(events);
  return () => listeners.delete(fn);
}

export function agoLabel(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchKlines, fetchTopSymbols, fmtPrice, type Candle, type Interval } from "@/lib/binance";
import { analyze, type Signal } from "@/lib/analysis";
import {
  conformalBand,
  forwardReturns,
  fractionalKelly,
  hawkesIntensity,
  quantile,
  bayes,
} from "@/lib/quant";
import { pushLog } from "@/lib/bus";
import { Panel, Pill, Stat } from "@/components/ui-bits";
import { INTERVALS } from "@/lib/binance";
import { cn } from "@/lib/utils";

/** Pluggable market source so the same engine can scan crypto or forex. */
export type ScanSource = {
  label: string;
  universeLabel: string;
  intervals: readonly Interval[];
  list: (limit: number) => Promise<string[]>;
  candles: (symbol: string, interval: Interval, limit: number) => Promise<Candle[]>;
  format?: (n: number) => string;
};

export const binanceSource: ScanSource = {
  label: "Binance USDⓈ-M",
  universeLabel: "Binance high-volume USDⓈ-M",
  intervals: INTERVALS,
  list: async (limit) => (await fetchTopSymbols(limit)).map((t) => t.symbol),
  candles: (symbol, interval, limit) => fetchKlines(symbol, interval, limit),
};

export type ScannerConfig = {
  key: string;
  title: string;
  blurb: string;
  defaultInterval: Interval;
  durationMs: number;
  universe: number;
  results: number;
  minProbability: number;
  horizon: string;
  useQuant?: boolean;
  source?: ScanSource;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out.push(await fn(items[idx]));
      } catch {
        /* skip symbol */
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export const TF_MINUTES: Record<string, number> = {
  "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
  "1h": 60, "2h": 120, "4h": 240, "6h": 360, "12h": 720, "1d": 1440,
};

/** Higher timeframe used to confirm the primary signal. */
export function htfOf(interval: Interval): Interval {
  const map: Record<string, Interval> = {
    "1m": "15m", "3m": "30m", "5m": "1h", "15m": "4h", "30m": "4h",
    "1h": "4h", "2h": "1d", "4h": "1d", "6h": "1d", "12h": "1d", "1d": "1d",
  };
  return map[interval] ?? "4h";
}

/** Average true range per bar — drives the "trade completes in" estimate. */
function avgRange(candles: Candle[], n = 30) {
  const tail = candles.slice(-n);
  if (!tail.length) return 0;
  return tail.reduce((a, c) => a + (c.h - c.l), 0) / tail.length;
}

/** Expected minutes for price to travel from entry to the first target. */
export function targetEta(candles: Candle[], interval: Interval, entry: number, tp: number) {
  const r = avgRange(candles);
  if (!r) return null;
  const bars = Math.max(1, Math.abs(tp - entry) / (r * 0.62));
  return Math.round(bars * (TF_MINUTES[interval] ?? 60));
}

export const etaLabel = (min: number) =>
  min < 60 ? `${min}m` : min < 1440 ? `${Math.round(min / 6) / 10}h` : `${(min / 1440).toFixed(1)}d`;

export type ScanResult = Signal & {
  quant?: { hawkes: number; kelly: number; band: string; bayes: number };
  htf?: { interval: Interval; bias: Signal["bias"]; agrees: boolean };
  etaMin?: number;
  completeBy?: number;
  grade?: "A+" | "A" | "B";
};


export function ScannerEngine({ config }: { config: ScannerConfig }) {
  const [interval, setIntervalTf] = useState<Interval>(config.defaultInterval);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [left, setLeft] = useState(config.durationMs / 1000);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [scannedCount, setScannedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [turbo, setTurbo] = useState(false);
  const [auto, setAuto] = useState(false);
  const [autoEvery, setAutoEvery] = useState(60);
  const abort = useRef(false);
  const runRef = useRef<() => void>(() => {});
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      abort.current = true;
      if (autoTimer.current) clearTimeout(autoTimer.current);
    },
    [],
  );

  const run = useCallback(async () => {
    if (running) return;
    abort.current = false;
    setRunning(true);
    setError(null);
    setProgress(0);
    const started = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - started;
      setLeft(Math.max(0, Math.ceil((config.durationMs - elapsed) / 1000)));
    }, 250);

    try {
      const src = config.source ?? binanceSource;
      const symbols = await src.list(config.universe);
      const depth = turbo ? 200 : 300;
      const fmt = src.format ?? fmtPrice;
      let done = 0;
      // Pass 1 — score the whole universe on the primary timeframe.
      const scored = await mapLimit(symbols, turbo ? 24 : 14, async (symbol) => {
        const candles = await src.candles(symbol, interval, depth);
        done++;
        if (done % 4 === 0 || done === symbols.length) {
          setProgress(Math.round((done / symbols.length) * 90));
        }
        const a = analyze(symbol, candles, interval);
        const sig = a.signal;
        let quant: ScanResult["quant"];
        if (config.useQuant) {
          const rets = candles.slice(-120).map((c, i, arr) => (i ? (c.c - arr[i - 1].c) / arr[i - 1].c : 0));
          const events = candles.slice(-40).filter((c) => c.v > 0).map((c) => c.t);
          const hawkes = hawkesIntensity(events, Date.now());
          const fwd = forwardReturns(candles, 12);
          const band = conformalBand(0, fwd, 0.1);
          const post = bayes(
            Math.min(0.95, sig.probability / 100),
            0.5,
            Math.max(0.05, 1 - sig.probability / 100),
          );
          quant = {
            hawkes,
            kelly: fractionalKelly(post, sig.rr),
            band: `±${(band.q * 100).toFixed(2)}%`,
            bayes: post,
          };
          const tail = Math.abs(quantile(rets, 0.05));
          sig.probability = Math.round(
            Math.min(99, sig.probability * 0.6 + post * 40 + (tail < 0.02 ? 6 : 0)),
          );
        }
        const etaMin = targetEta(candles, interval, sig.entry, sig.targets[0] ?? sig.entry);
        return {
          ...sig,
          quant,
          ...(etaMin ? { etaMin, completeBy: Date.now() + etaMin * 60_000 } : {}),
        } as ScanResult;
      });

      setScannedCount(scored.length);

      // Pass 2 — higher-timeframe confirmation on the shortlist only.
      const shortlist = scored
        .filter((s) => s.bias !== "neutral" && s.probability >= config.minProbability - 8)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, Math.max(config.results * 3, 12));

      const htf = htfOf(interval);
      const confirmed = await mapLimit(shortlist, 8, async (s) => {
        try {
          const hc = await src.candles(s.symbol, htf, 180);
          const ha = analyze(s.symbol, hc, htf).signal;
          const agrees = ha.bias === s.bias;
          const neutral = ha.bias === "neutral";
          const probability = Math.round(
            Math.max(
              1,
              Math.min(99, s.probability + (agrees ? 7 : neutral ? 0 : -14)),
            ),
          );
          const grade: ScanResult["grade"] =
            agrees && probability >= 85 ? "A+" : agrees ? "A" : "B";
          return { ...s, probability, htf: { interval: htf, bias: ha.bias, agrees }, grade };
        } catch {
          return s;
        }
      });
      setProgress(100);

      const elapsed = Date.now() - started;
      // Turbo publishes the moment the maths is done instead of padding to the
      // advertised scan window.
      if (!turbo && elapsed < config.durationMs) {
        await new Promise((r) => setTimeout(r, config.durationMs - elapsed));
      }
      if (abort.current) return;

      const top = confirmed
        .filter((s) => s.probability >= config.minProbability && s.htf?.agrees !== false)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, config.results);

      setResults(top);
      setScannedAt(Date.now());
      top.forEach((s) =>
        pushLog({
          kind: "signal",
          symbol: s.symbol,
          text: `${config.title}: ${s.bias.toUpperCase()} ${s.symbol} @ ${fmt(s.entry)}`,
          meta: `${s.probability}% confluence · SL ${fmt(s.stop)} · TP1 ${fmt(s.targets[0])}${
            s.etaMin ? ` · TP expected in ~${etaLabel(s.etaMin)}` : ""
          }`,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      clearInterval(tick);
      setRunning(false);
      setLeft(config.durationMs / 1000);
    }
  }, [config, interval, running, turbo]);


  runRef.current = () => void run();

  // High-frequency mode: keep re-scanning on a fixed cadence.
  useEffect(() => {
    if (!auto || running) return;
    autoTimer.current = setTimeout(() => runRef.current(), autoEvery * 1000);
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, [auto, running, autoEvery]);


  return (
    <div className="space-y-4">
      <Panel
        title={config.title}
        subtitle={config.blurb}
        right={
          <button
            onClick={run}
            disabled={running}
            className={cn(
              "num rounded-lg px-4 py-2 text-sm font-semibold",
              running
                ? "border border-border text-muted-foreground"
                : "bg-primary text-primary-foreground",
            )}
          >
            {running
              ? `SCANNING ${turbo ? "" : `${left}s`}`.trim()
              : turbo
                ? "Run turbo scan"
                : `Run ${config.durationMs / 1000}s deep scan`}
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Timeframe</span>
          {(config.source?.intervals ?? INTERVALS).map((i) => (
            <button
              key={i}
              onClick={() => setIntervalTf(i)}
              className={cn(
                "num rounded border border-border px-2 py-1 text-xs",
                i === interval
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {i}
            </button>
          ))}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">High frequency</span>
          <button
            onClick={() => setTurbo(!turbo)}
            className={cn(
              "rounded border px-2 py-1 text-[10px] uppercase tracking-wider",
              turbo ? "border-warn/60 bg-warn/15 text-warn" : "border-border text-muted-foreground",
            )}
          >
            Turbo {turbo ? "on" : "off"}
          </button>
          <button
            onClick={() => setAuto(!auto)}
            className={cn(
              "rounded border px-2 py-1 text-[10px] uppercase tracking-wider",
              auto ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground",
            )}
          >
            Auto re-scan {auto ? "on" : "off"}
          </button>
          {[15, 30, 60, 120].map((s) => (
            <button
              key={s}
              onClick={() => setAutoEvery(s)}
              disabled={!auto}
              className={cn(
                "num rounded border border-border px-2 py-1 text-xs disabled:opacity-40",
                autoEvery === s ? "border-primary/60 bg-primary/15 text-primary" : "text-muted-foreground",
              )}
            >
              {s}s
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Universe" value={`${config.universe} ${config.source ? "instruments" : "coins"}`} hint={(config.source ?? binanceSource).universeLabel} />
          <Stat label="Analysed" value={scannedCount || "—"} hint="symbols this run" />
          <Stat label="Progress" value={`${progress}%`} />
          <Stat
            label="Min confluence"
            value={`${config.minProbability}%`}
            hint={config.horizon}
          />
        </div>
        {running && (
          <div className="mt-3 h-1.5 overflow-hidden rounded bg-secondary">
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {error && <p className="mt-3 text-xs text-bear">Scan error: {error}</p>}
      </Panel>

      {scannedAt && !results.length && (
        <Panel>
          <p className="text-sm text-muted-foreground">
            No setup cleared the {config.minProbability}% confluence filter this run. That is a
            valid result — no trade is better than a forced trade. Re-scan after the next candle
            closes.
          </p>
        </Panel>
      )}

      {scannedAt && results.length > 0 && (
        <Panel
          title="Export scan report"
          subtitle={`${results.length} setups · probability, TP/SL zones and scan timestamps · scanned ${new Date(scannedAt).toLocaleTimeString()}`}
          right={
            <div className="flex gap-2">
              <button
                onClick={() => exportScanCsv(results, scannedAt, config.key)}
                className="rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
              >
                Export CSV
              </button>
              <button
                onClick={() => exportScanJson(results, scannedAt, config.key)}
                className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent"
              >
                Export JSON
              </button>
            </div>
          }
        >
          <p className="text-xs text-muted-foreground">
            CSV opens in Excel/Sheets; JSON carries the same fields plus full confluence detail for
            bots and journals.
          </p>
        </Panel>
      )}


      <div className="grid gap-3 lg:grid-cols-2">
        {results.map((s) => (
          <SignalCard key={s.symbol} signal={s} horizon={config.horizon} fmt={config.source?.format} />
        ))}
      </div>

    </div>
  );
}

export function SignalCard({
  signal,
  horizon,
  fmt = fmtPrice,
}: {
  signal: ScanResult;
  horizon: string;
  fmt?: (n: number) => string;
}) {
  const long = signal.bias === "long";
  return (
    <article className="panel p-4">
      <header className="flex items-start justify-between">
        <div>
          <div className="num text-lg font-bold">{signal.symbol}</div>
          <div className="flex gap-1.5 pt-1">
            <Pill tone={long ? "bull" : "bear"}>{signal.bias}</Pill>
            <Pill tone="primary">{signal.probability}% confluence</Pill>
            <Pill>{signal.interval}</Pill>
            {signal.grade && <Pill tone={signal.grade === "B" ? "warn" : "bull"}>{signal.grade} grade</Pill>}
            {signal.htf && (
              <Pill tone={signal.htf.agrees ? "bull" : "warn"}>
                {signal.htf.interval} {signal.htf.agrees ? "aligned" : signal.htf.bias}
              </Pill>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-muted-foreground">Target window</div>
          <div className="num text-sm">{horizon}</div>
          {signal.etaMin && (
            <div className="num pt-1 text-[11px] text-primary">
              TP1 in ~{etaLabel(signal.etaMin)}
              {signal.completeBy
                ? ` · by ${new Date(signal.completeBy).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </div>
          )}
        </div>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Entry" value={fmt(signal.entry)} />
        <Stat label="Stop" value={fmt(signal.stop)} tone="bear" />
        {signal.targets.map((t, i) => (
          <Stat key={i} label={`TP${i + 1}`} value={fmt(t)} tone="bull" />
        ))}
      </div>

      {signal.quant && (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Hawkes λ(t)" value={signal.quant.hawkes.toFixed(3)} />
          <Stat label="Bayes P(H|E)" value={`${(signal.quant.bayes * 100).toFixed(1)}%`} />
          <Stat label="Frac. Kelly f*" value={`${(signal.quant.kelly * 100).toFixed(2)}%`} />
          <Stat label="Conformal band" value={signal.quant.band} />
        </div>
      )}

      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
        {signal.confluence.map((c) => (
          <li key={c.label} className="flex items-center justify-between gap-2">
            <span>
              <span
                className={cn(
                  "mr-1.5 inline-block size-1.5 rounded-full",
                  c.bias === "long" ? "bg-bull" : c.bias === "short" ? "bg-bear" : "bg-muted-foreground",
                )}
              />
              {c.label}
            </span>
            <span className="num text-right">{c.detail}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={() => exportSignalCsv(signal)}
        className="mt-3 w-full rounded-lg border border-border py-1.5 text-xs text-muted-foreground hover:bg-secondary"
      >
        Export CSV report
      </button>
    </article>
  );
}

function download(name: string, mime: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const stamp = (t: number) => new Date(t).toISOString();

/** Flat export record: probability, TP/SL zones and scan timestamps. */
export function exportRows(signals: ScanResult[], scannedAt: number) {
  return signals.map((s) => ({
    symbol: s.symbol,
    bias: s.bias,
    interval: s.interval,
    probability: s.probability,
    rr: Number(s.rr.toFixed(2)),
    entry: s.entry,
    stop: s.stop,
    slZoneLow: Math.min(s.entry, s.stop),
    slZoneHigh: Math.max(s.entry, s.stop),
    tp1: s.targets[0] ?? null,
    tp2: s.targets[1] ?? null,
    tp3: s.targets[2] ?? null,
    tpZoneLow: Math.min(s.entry, ...s.targets),
    tpZoneHigh: Math.max(s.entry, ...s.targets),
    hawkes: s.quant?.hawkes ?? null,
    bayes: s.quant?.bayes ?? null,
    kelly: s.quant?.kelly ?? null,
    conformalBand: s.quant?.band ?? null,
    htfInterval: s.htf?.interval ?? null,
    htfBias: s.htf?.bias ?? null,
    htfAligned: s.htf?.agrees ?? null,
    grade: s.grade ?? null,
    expectedMinutesToTp1: s.etaMin ?? null,
    expectedCompletionAt: s.completeBy ? stamp(s.completeBy) : null,
    signalCreatedAt: stamp(s.createdAt),
    scanCompletedAt: stamp(scannedAt),
    exportedAt: stamp(Date.now()),
    confluence: s.confluence.map((c) => `${c.label} (${c.bias} ${c.weight.toFixed(1)}): ${c.detail}`).join(" | "),
  }));
}

export function exportScanCsv(signals: ScanResult[], scannedAt: number, key = "scan") {
  const rows = exportRows(signals, scannedAt);
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => csvCell((r as Record<string, unknown>)[h])).join(",")),
  ].join("\n");
  download(`cotraders-${key}-${scannedAt}.csv`, "text/csv;charset=utf-8", csv);
}

export function exportScanJson(signals: ScanResult[], scannedAt: number, key = "scan") {
  const payload = {
    scanner: key,
    scanCompletedAt: stamp(scannedAt),
    exportedAt: stamp(Date.now()),
    count: signals.length,
    results: exportRows(signals, scannedAt),
  };
  download(`cotraders-${key}-${scannedAt}.json`, "application/json", JSON.stringify(payload, null, 2));
}

export function exportSignalCsv(signal: ScanResult) {
  exportScanCsv([signal], signal.createdAt, `${signal.symbol}-${signal.interval}`);
}


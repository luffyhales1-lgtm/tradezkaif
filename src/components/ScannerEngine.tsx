import { useCallback, useEffect, useRef, useState } from "react";
import { fetchKlines, fetchTopSymbols, fmtPrice, type Candle, type Interval } from "@/lib/binance";
import { analyze, qualify, type Qualification, type Signal } from "@/lib/analysis";
import {
  conformalBand,
  forwardReturns,
  fractionalKelly,
  hawkesIntensity,
  quantile,
  bayes,
  rmtSignalRatio,
} from "@/lib/quant";
import { pushLog } from "@/lib/bus";
import { Panel, Pill, Stat } from "@/components/ui-bits";
import { INTERVALS } from "@/lib/binance";
import { SignalScreener } from "@/components/SignalScreener";
import { downloadReportPdf } from "@/lib/pdf";
import { cn } from "@/lib/utils";
import {
  defaultScannerSettings,
  SCANNER_PRESETS,
  type ScannerSettings,
} from "@/lib/scanner-settings";


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
  quant?: { hawkes: number; kelly: number; band: string; bayes: number; rmt: number };
  htf?: { interval: Interval; bias: Signal["bias"]; agrees: boolean };
  etaMin?: number;
  completeBy?: number;
  grade?: "A+" | "A" | "B";
  momentum?: number;
  qualification?: Qualification;
};


type PaperPosition = {
  id: string;
  symbol: string;
  bias: "long" | "short";
  entry: number;
  mark: number;
  stop: number;
  target: number;
  amount: number;
  openedAt: number;
  closedAt?: number;
  status: "open" | "tp" | "sl" | "closed";
  pnl: number;
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
  const [strict, setStrict] = useState(true);
  const [auto, setAuto] = useState(false);

  const [autoEvery, setAutoEvery] = useState(60);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ScannerSettings>(() => {
    if (typeof window === "undefined") return defaultScannerSettings(config.minProbability);
    try {
      const saved = window.localStorage.getItem(`cotraders.scanner.${config.key}`);
      return saved ? { ...defaultScannerSettings(config.minProbability), ...JSON.parse(saved) } : defaultScannerSettings(config.minProbability);
    } catch {
      return defaultScannerSettings(config.minProbability);
    }
  });
  const [paperAmount, setPaperAmount] = useState(100);
  const [paperPositions, setPaperPositions] = useState<PaperPosition[]>([]);
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

  useEffect(() => {
    window.localStorage.setItem(`cotraders.scanner.${config.key}`, JSON.stringify(settings));
  }, [config.key, settings]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`cotraders.paper.${config.key}`);
      if (saved) setPaperPositions(JSON.parse(saved) as PaperPosition[]);
    } catch {
      setPaperPositions([]);
    }
  }, [config.key]);

  useEffect(() => {
    window.localStorage.setItem(`cotraders.paper.${config.key}`, JSON.stringify(paperPositions));
  }, [config.key, paperPositions]);

  useEffect(() => {
    if (!paperPositions.some((position) => position.status === "open")) return;
    const source = config.source ?? binanceSource;
    let active = true;
    const update = async () => {
      const open = paperPositions.filter((position) => position.status === "open");
      const marks = await mapLimit(open, 6, async (position) => {
        const candles = await source.candles(position.symbol, interval, 2);
        return { id: position.id, mark: candles.at(-1)?.c ?? position.mark };
      });
      if (!active || !marks.length) return;
      const markMap = new Map(marks.map((item) => [item.id, item.mark]));
      setPaperPositions((current) => current.map((position) => {
        if (position.status !== "open") return position;
        const mark = markMap.get(position.id) ?? position.mark;
        const move = position.bias === "long" ? (mark - position.entry) / position.entry : (position.entry - mark) / position.entry;
        const hitTp = position.bias === "long" ? mark >= position.target : mark <= position.target;
        const hitSl = position.bias === "long" ? mark <= position.stop : mark >= position.stop;
        const status = hitTp ? "tp" : hitSl ? "sl" : "open";
        if (status !== "open") {
          pushLog({ kind: "paper", symbol: position.symbol, text: `PAPER ${status.toUpperCase()} · ${position.bias.toUpperCase()}`, meta: `${move >= 0 ? "+" : ""}${(move * position.amount).toFixed(2)} USDT` });
        }
        return { ...position, mark, pnl: move * position.amount, status, ...(status !== "open" ? { closedAt: Date.now() } : {}) };
      }));
    };
    void update();
    const timer = setInterval(update, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [config.source, interval, paperPositions.some((position) => position.status === "open")]);

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
        const a = analyze(symbol, candles, interval, null, {
          structureStrength: settings.structureStrength / 100,
          maxAtrPct: settings.maxAtrPct / 100,
        });
        const sig = a.signal;
        // Quant pack now runs on every scanner, not just Ultimate.
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
        // Marchenko–Pastur signal/noise on close, delta and volume streams.
        const rmt = rmtSignalRatio([
          rets,
          a.delta.slice(-120).map((d) => d.ratio),
          candles.slice(-120).map((c) => c.v),
        ]);
        const quant: ScanResult["quant"] = {
          hawkes,
          kelly: fractionalKelly(post, sig.rr),
          band: `±${(band.q * 100).toFixed(2)}%`,
          bayes: post,
          rmt,
        };
        const tail = Math.abs(quantile(rets, 0.05));
        sig.probability = Math.round(
          Math.min(
            99,
            sig.probability * 0.58 + post * 40 + (tail < 0.02 ? 6 : 0) + Math.min(8, rmt * 24),
          ),
        );
        const qualification = qualify(a, { minMomentum: settings.minMomentum });
        const etaMin = targetEta(candles, interval, sig.entry, sig.targets[0] ?? sig.entry);
        return {
          ...sig,
          quant,
          qualification,
          momentum: a.momentum,
          ...(etaMin ? { etaMin, completeBy: Date.now() + etaMin * 60_000 } : {}),
        } as ScanResult;
      });


      setScannedCount(scored.length);

      // Pass 2 — shortlist must already clear every required factor, then get
      // higher-timeframe confirmation.
      const shortlist = scored
        .filter(
          (s) =>
            s.bias !== "neutral" &&
            s.probability >= config.minProbability - 8 &&
            (!strict || s.qualification?.cleared),
        )
        .sort((a, b) => b.probability - a.probability)
        .slice(0, Math.max(config.results * 3, 12));


      const htf = htfOf(interval);
      const confirmed = await mapLimit(shortlist, 8, async (s) => {
        try {
          const hc = await src.candles(s.symbol, htf, 180);
          const ha = analyze(s.symbol, hc, htf, null, {
            structureStrength: settings.structureStrength / 100,
            maxAtrPct: settings.maxAtrPct / 100,
          }).signal;
          const agrees = ha.bias === s.bias && ha.probability >= settings.htfStrength;
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
        .filter(
          (s) =>
            s.probability >= settings.minProbability &&
            s.rr >= settings.minRiskReward &&
            s.htf?.agrees !== false &&
            (s.momentum ?? 0) >= settings.minMomentum &&
            (!strict || s.qualification?.cleared),
        )
        .sort((a, b) => (b.momentum ?? 0) + b.probability * 1.4 - ((a.momentum ?? 0) + a.probability * 1.4))
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
  }, [config, interval, running, settings, turbo, strict]);

  const openPaper = useCallback((signal: ScanResult) => {
    if (signal.bias === "neutral" || !signal.targets[0] || paperAmount <= 0) return;
    const position: PaperPosition = {
      id: `${signal.symbol}-${Date.now()}`,
      symbol: signal.symbol,
      bias: signal.bias,
      entry: signal.entry,
      mark: signal.entry,
      stop: signal.stop,
      target: signal.targets[0],
      amount: paperAmount,
      openedAt: Date.now(),
      status: "open",
      pnl: 0,
    };
    setPaperPositions((current) => [position, ...current].slice(0, 100));
    pushLog({ kind: "paper", symbol: signal.symbol, text: `PAPER ${signal.bias.toUpperCase()} opened @ ${signal.entry}`, meta: `${paperAmount.toFixed(2)} USDT · SL ${signal.stop} · TP ${signal.targets[0]}` });
  }, [paperAmount]);


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
          <button
            onClick={() => setSettingsOpen((open) => !open)}
            className="rounded border border-primary/50 px-2 py-1 text-xs text-primary"
          >
            Advanced settings
          </button>
          {Object.entries(SCANNER_PRESETS).map(([name, preset]) => (
            <button key={name} onClick={() => setSettings(preset)} className="rounded border border-border px-2 py-1 text-xs capitalize text-muted-foreground">
              {name.replace(/([A-Z])/g, " $1")}
            </button>
          ))}
          <span className="text-[10px] text-muted-foreground">Saved for this strategy</span>
        </div>

        {settingsOpen && (
          <div className="mb-3 grid gap-3 border-y border-border py-3 sm:grid-cols-2 lg:grid-cols-5">
            {([
              ["minProbability", "Min probability", 55, 95, 1, "%"],
              ["htfStrength", "HTF strength", 40, 90, 1, "%"],
              ["structureStrength", "Structure strength", 10, 80, 1, "%"],
              ["maxAtrPct", "Max volatility", 1, 10, 0.5, "% ATR"],
              ["minRiskReward", "Minimum R:R", 1, 3, 0.05, "R"],
              ["minMomentum", "Min momentum", 20, 95, 1, "/100"],

            ] as const).map(([key, label, min, max, step, suffix]) => (
              <label key={key} className="text-xs text-muted-foreground">
                <span className="flex justify-between"><span>{label}</span><span className="num text-foreground">{settings[key]}{suffix}</span></span>
                <input type="range" min={min} max={max} step={step} value={settings[key]} onChange={(event) => setSettings((current) => ({ ...current, [key]: Number(event.target.value) }))} className="mt-1 w-full accent-primary" />
              </label>
            ))}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">High frequency</span>
          <button
            onClick={() => setStrict(!strict)}
            className={cn(
              "rounded border px-2 py-1 text-[10px] uppercase tracking-wider",
              strict ? "border-bull/60 bg-bull/15 text-bull" : "border-border text-muted-foreground",
            )}
            title="Only publish setups where every required factor agrees and momentum is high"
          >
            Full-confluence gate {strict ? "on" : "off"}
          </button>

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
            value={`${settings.minProbability}%`}
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
             No setup cleared the {settings.minProbability}% confluence filter this run. That is a
            valid result — no trade is better than a forced trade. Re-scan after the next candle
            closes.
          </p>
        </Panel>
      )}

      <Panel title="Paper trading" subtitle="Virtual positions use each setup's fixed entry, SL and TP1">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">
            Position amount (USDT)
            <input type="number" min="1" step="10" value={paperAmount} onChange={(event) => setPaperAmount(Math.max(1, Number(event.target.value) || 1))} className="mt-1 block w-36 rounded border border-border bg-background px-2 py-1.5 text-foreground" />
          </label>
          <Stat label="Open" value={paperPositions.filter((position) => position.status === "open").length} />
          <Stat label="Realized + live P&L" value={`${paperPositions.reduce((sum, position) => sum + position.pnl, 0).toFixed(2)} USDT`} tone={paperPositions.reduce((sum, position) => sum + position.pnl, 0) >= 0 ? "bull" : "bear"} />
          {paperPositions.length > 0 && <button onClick={() => setPaperPositions([])} className="rounded border border-border px-2 py-1.5 text-xs text-muted-foreground">Clear paper book</button>}
        </div>
        <div className="max-h-48 overflow-auto text-xs">
          {paperPositions.map((position) => (
            <div key={position.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-t border-border py-2">
              <span><strong>{position.symbol}</strong> · {position.bias.toUpperCase()} · {position.amount.toFixed(0)} USDT</span>
              <span className="num">mark {((config.source?.format ?? fmtPrice)(position.mark))}</span>
              <span className={cn("num", position.pnl >= 0 ? "text-bull" : "text-bear")}>{position.pnl >= 0 ? "+" : ""}{position.pnl.toFixed(2)}</span>
              <Pill tone={position.status === "tp" ? "bull" : position.status === "sl" ? "bear" : "primary"}>{position.status}</Pill>
            </div>
          ))}
          {!paperPositions.length && <p className="py-4 text-center text-muted-foreground">Open a paper position from any scanner result.</p>}
        </div>
      </Panel>

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
              <button
                onClick={() => exportScanPdf(results, scannedAt, config.title, config.key)}
                className="rounded-lg border border-bull/50 bg-bull/10 px-3 py-1.5 text-xs font-semibold text-bull"
              >
                Download PDF
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
          <SignalCard key={s.symbol} signal={s} horizon={config.horizon} fmt={config.source?.format} onPaper={openPaper} paperAmount={paperAmount} />
        ))}
      </div>

    </div>
  );
}

export function SignalCard({
  signal,
  horizon,
  fmt = fmtPrice,
  onPaper,
  paperAmount,
}: {
  signal: ScanResult;
  horizon: string;
  fmt?: (n: number) => string;
  onPaper?: (signal: ScanResult) => void;
  paperAmount?: number;
}) {
  const long = signal.bias === "long";
  const [showScreener, setShowScreener] = useState(true);

  return (
    <article className="panel p-4">
      <header className="flex items-start justify-between">
        <div>
          <div className="num text-lg font-bold">{signal.symbol}</div>
          <div className="flex gap-1.5 pt-1">
            <Pill tone={long ? "bull" : "bear"}>{signal.bias}</Pill>
            <Pill tone="primary">{signal.probability}% confluence</Pill>
            <Pill>{signal.interval}</Pill>
            {signal.momentum !== undefined && (
              <Pill tone={signal.momentum >= 70 ? "bull" : "warn"}>momentum {signal.momentum}/100</Pill>
            )}
            {signal.qualification?.cleared && <Pill tone="bull">all factors cleared</Pill>}

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
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          <Stat label="Hawkes λ(t)" value={signal.quant.hawkes.toFixed(3)} />
          <Stat label="Bayes P(H|E)" value={`${(signal.quant.bayes * 100).toFixed(1)}%`} />
          <Stat label="Frac. Kelly f*" value={`${(signal.quant.kelly * 100).toFixed(2)}%`} />
          <Stat label="Conformal band" value={signal.quant.band} />
          <Stat label="RMT signal" value={`${(signal.quant.rmt * 100).toFixed(1)}%`} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Live screener</span>
        <button
          onClick={() => setShowScreener((open) => !open)}
          className="rounded border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-secondary"
        >
          {showScreener ? "Hide" : "Show"}
        </button>
      </div>
      {showScreener && signal.bias !== "neutral" && (
        <SignalScreener
          symbol={signal.symbol}
          interval={signal.interval as Interval}
          bias={signal.bias}
          entry={signal.entry}
          stop={signal.stop}
          targets={signal.targets}
          fmt={fmt}
        />
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
      {onPaper && (
        <button onClick={() => onPaper(signal)} className="mt-2 w-full rounded-lg border border-primary/50 bg-primary/10 py-1.5 text-xs font-semibold text-primary">
          Open {paperAmount?.toFixed(0)} USDT paper trade
        </button>
      )}
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


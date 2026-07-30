/** Quant formula pack: Hawkes intensity, Bayesian, quantile vol, conformal, Kelly, RMT. */
import type { Candle, Trade } from "@/lib/binance";

/** λ(t) = μ + Σ α·e^{-β(t-tᵢ)} — self-exciting order-flow burst intensity. */
export function hawkesIntensity(events: number[], now: number, alpha = 0.85, beta = 0.0009, mu = 0.15) {
  return events.reduce((sum, ti) => sum + alpha * Math.exp(-beta * (now - ti)), mu);
}

export function hawkesFromTrades(trades: Trade[], side: "buy" | "sell") {
  const now = Date.now();
  const evs = trades
    .filter((t) => (side === "buy" ? !t.buyerMaker : t.buyerMaker))
    .map((t) => t.ts);
  return hawkesIntensity(evs, now);
}

/** P(H|E) = P(E|H)P(H)/P(E) */
export function bayes(pEgivenH: number, pH: number, pEgivenNotH: number) {
  const pE = pEgivenH * pH + pEgivenNotH * (1 - pH);
  return pE === 0 ? 0 : (pEgivenH * pH) / pE;
}

/** Qτ(r_{t+h}|X_t) — empirical conditional quantile of forward returns. */
export function quantile(values: number[], tau: number) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round(tau * (s.length - 1))));
  return s[idx];
}

export function forwardReturns(candles: Candle[], horizon = 12) {
  const out: number[] = [];
  for (let i = 0; i + horizon < candles.length; i++) {
    out.push((candles[i + horizon].c - candles[i].c) / candles[i].c);
  }
  return out;
}

/** C_t = [ŷ_t − q̂, ŷ_t + q̂] — conformal prediction band. */
export function conformalBand(pred: number, residuals: number[], alpha = 0.1) {
  const q = quantile(residuals.map(Math.abs), 1 - alpha);
  return { low: pred - q, high: pred + q, q };
}

/** f* = c(bp − q)/b — fractional Kelly position size. */
export function fractionalKelly(winProb: number, rr: number, fraction = 0.25) {
  const b = rr;
  const p = winProb;
  const q = 1 - p;
  const f = (b * p - q) / b;
  return Math.max(0, f * fraction);
}

/** C = (1/T)XXᵀ → λᵢ — Marchenko–Pastur noise filter on the eigenvalue spectrum. */
export function rmtSignalRatio(series: number[][]) {
  const T = series[0]?.length ?? 0;
  const N = series.length;
  if (!T || !N) return 0;
  const norm = series.map((row) => {
    const m = row.reduce((a, b) => a + b, 0) / row.length;
    const sd = Math.sqrt(row.reduce((a, b) => a + (b - m) ** 2, 0) / row.length) || 1;
    return row.map((v) => (v - m) / sd);
  });
  // Power-iteration on the correlation matrix for the leading eigenvalue.
  const corr = (i: number, j: number) =>
    norm[i].reduce((a, _, k) => a + norm[i][k] * norm[j][k], 0) / T;
  let v = new Array(N).fill(1 / Math.sqrt(N));
  for (let it = 0; it < 25; it++) {
    const nv = new Array(N).fill(0);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) nv[i] += corr(i, j) * v[j];
    const mag = Math.sqrt(nv.reduce((a, b) => a + b * b, 0)) || 1;
    v = nv.map((x) => x / mag);
  }
  let lambda = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) lambda += v[i] * corr(i, j) * v[j];
  const q = N / T;
  const lambdaMax = (1 + Math.sqrt(q)) ** 2;
  return Math.max(0, (lambda - lambdaMax) / Math.max(1e-9, lambda));
}

export type FormulaReadout = {
  key: string;
  name: string;
  formula: string;
  value: string;
  bias: "long" | "short" | "neutral";
  note: string;
};

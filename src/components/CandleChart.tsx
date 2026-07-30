import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "@/lib/binance";

export type ChartZone = {
  low: number;
  high: number;
  color: string;
  label: string;
  group: "liquidity" | "ob" | "fib" | "long" | "short" | "sr";
};

export type ChartLine = {
  price: number;
  color: string;
  label: string;
  dashed?: boolean;
  group: "long" | "short" | "fib" | "sr";
};

type Props = {
  candles: Candle[];
  zones?: ChartZone[];
  lines?: ChartLine[];
  height?: number;
  symbol: string;
};

/**
 * Canvas candle chart with wheel zoom, drag pan and overlay rendering.
 * Draws only on new frames of data or view changes to keep the UI smooth,
 * and swallows wheel events so the page never scrolls while zooming.
 */
export function CandleChart({ candles, zones = [], lines = [], height = 460, symbol }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ count: 140, offset: 0 });
  const drag = useRef<{ x: number; offset: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => setView((v) => ({ ...v, offset: 0 })), [symbol]);

  const visible = useMemo(() => {
    const end = Math.max(1, candles.length - view.offset);
    return candles.slice(Math.max(0, end - view.count), end);
  }, [candles, view]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !visible.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setFailed(true);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padR = 74;
    const padB = 22;
    const plotW = w - padR;
    const plotH = h - padB;

    const prices = visible.flatMap((c) => [c.h, c.l]);
    const zonePrices = zones.flatMap((z) => [z.low, z.high]);
    const linePrices = lines.map((l) => l.price);
    const all = [...prices, ...zonePrices, ...linePrices].filter((n) => Number.isFinite(n));
    let min = Math.min(...all);
    let max = Math.max(...all);
    const pad = (max - min) * 0.08 || max * 0.001;
    min -= pad;
    max += pad;
    const y = (p: number) => plotH - ((p - min) / (max - min || 1)) * plotH;
    const cw = plotW / visible.length;

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const py = (plotH / 6) * i;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(plotW, py);
      ctx.stroke();
      const price = max - ((max - min) / 6) * i;
      ctx.fillText(price >= 1000 ? price.toFixed(1) : price.toFixed(5), plotW + 6, py + 3);
    }

    // zones
    zones.forEach((z) => {
      const top = y(Math.max(z.low, z.high));
      const bottom = y(Math.min(z.low, z.high));
      ctx.fillStyle = z.color;
      ctx.fillRect(0, top, plotW, Math.max(2, bottom - top));
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "10px ui-sans-serif, system-ui";
      ctx.fillText(z.label, 6, top - 3 < 10 ? top + 11 : top - 3);
    });

    // candles
    visible.forEach((c, i) => {
      const x = i * cw + cw / 2;
      const up = c.c >= c.o;
      ctx.strokeStyle = up ? "#3ddc97" : "#ff5f56";
      ctx.fillStyle = up ? "#3ddc97" : "#ff5f56";
      ctx.beginPath();
      ctx.moveTo(x, y(c.h));
      ctx.lineTo(x, y(c.l));
      ctx.stroke();
      const bodyTop = y(Math.max(c.o, c.c));
      const bodyH = Math.max(1, Math.abs(y(c.o) - y(c.c)));
      ctx.fillRect(x - Math.max(1, cw * 0.32), bodyTop, Math.max(2, cw * 0.64), bodyH);
    });

    // lines
    lines.forEach((l) => {
      const py = y(l.price);
      ctx.strokeStyle = l.color;
      ctx.setLineDash(l.dashed ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(plotW, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = l.color;
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(l.label, plotW - ctx.measureText(l.label).width - 6, py - 3);
    });

    // last price
    const last = visible.at(-1)!;
    const ly = y(last.c);
    ctx.fillStyle = last.c >= last.o ? "#3ddc97" : "#ff5f56";
    ctx.fillRect(plotW, ly - 8, padR, 16);
    ctx.fillStyle = "#0b1220";
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.fillText(last.c >= 1000 ? last.c.toFixed(1) : last.c.toFixed(5), plotW + 5, ly + 3);

    // crosshair
    if (hover) {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hover.x, 0);
      ctx.lineTo(hover.x, plotH);
      ctx.moveTo(0, hover.y);
      ctx.lineTo(plotW, hover.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const p = min + ((plotH - hover.y) / plotH) * (max - min);
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(plotW, hover.y - 8, padR, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(p >= 1000 ? p.toFixed(1) : p.toFixed(5), plotW + 5, hover.y + 3);
    }
  }, [visible, zones, lines, height, hover]);

  useEffect(() => {
    const raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          const step = Math.sign(e.deltaX || e.deltaY) * Math.max(1, Math.round(v.count * 0.05));
          return {
            ...v,
            offset: Math.min(Math.max(0, candles.length - v.count), Math.max(0, v.offset - step)),
          };
        }
        const factor = e.deltaY > 0 ? 1.12 : 0.89;
        const count = Math.round(Math.min(600, Math.max(25, v.count * factor)));
        return { ...v, count };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [candles.length]);

  return (
    <div className="relative">
      <div
        ref={wrapRef}
        className="relative touch-none select-none overflow-hidden rounded-lg bg-[oklch(0.19_0.03_252)]"
        style={{ height }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, offset: view.offset };
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => {
          drag.current = null;
          setHover(null);
        }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x;
          const perCandle = (rect.width - 74) / view.count;
          const shift = Math.round(dx / perCandle);
          setView((v) => ({
            ...v,
            offset: Math.min(
              Math.max(0, candles.length - v.count),
              Math.max(0, drag.current!.offset + shift),
            ),
          }));
        }}
      >
        <canvas ref={canvasRef} className="block" />
        {(!visible.length || failed) && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            {failed ? "Canvas unavailable — chart data still streaming below." : "Loading live candles…"}
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Scroll = zoom · Shift+scroll or drag = pan · {view.count} candles</span>
        <button
          className="rounded border border-border px-2 py-0.5 hover:bg-secondary"
          onClick={() => setView({ count: 140, offset: 0 })}
        >
          Reset view
        </button>
      </div>
    </div>
  );
}

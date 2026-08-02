import { useEffect, useRef, useState } from "react";
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

const MIN_COUNT = 20;
const MAX_COUNT = 600;
const PAD_R = 74;
const PAD_B = 22;

/**
 * Canvas candle chart driven entirely by refs + a single rAF loop.
 * React never re-renders on pan/zoom/crosshair, so the chart stays smooth
 * even while websocket data streams in behind it.
 * Supports wheel zoom, drag pan, two-finger pinch and on-screen controls.
 */
export function CandleChart({ candles, zones = [], lines = [], height = 460, symbol }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const candlesRef = useRef(candles);
  const zonesRef = useRef(zones);
  const linesRef = useRef(lines);
  const viewRef = useRef({ count: 140, offset: 0 });
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const dirty = useRef(true);
  const [countLabel, setCountLabel] = useState(140);

  candlesRef.current = candles;
  zonesRef.current = zones;
  linesRef.current = lines;

  // any new data frame or overlay change requests one repaint
  useEffect(() => {
    dirty.current = true;
  }, [candles, zones, lines, height]);

  useEffect(() => {
    viewRef.current = { count: viewRef.current.count, offset: 0 };
    dirty.current = true;
  }, [symbol]);

  const clampView = (count: number, offset: number) => {
    const len = candlesRef.current.length || 1;
    const c = Math.round(Math.min(MAX_COUNT, Math.max(MIN_COUNT, count)));
    const o = Math.min(Math.max(0, len - c), Math.max(0, Math.round(offset)));
    return { count: c, offset: o };
  };

  const setView = (count: number, offset: number) => {
    const next = clampView(count, offset);
    const prev = viewRef.current;
    if (next.count === prev.count && next.offset === prev.offset) return;
    viewRef.current = next;
    dirty.current = true;
    if (next.count !== prev.count) setCountLabel(next.count);
  };

  // ---------- render loop ----------
  useEffect(() => {
    let raf = 0;
    let lastW = 0;

    const render = () => {
      raf = requestAnimationFrame(render);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const w = wrap.clientWidth;
      if (w !== lastW) {
        lastW = w;
        dirty.current = true;
      }
      if (!dirty.current) return;
      dirty.current = false;

      const all = candlesRef.current;
      if (!all.length || !w) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { count, offset } = viewRef.current;
      const end = Math.max(1, all.length - offset);
      const visible = all.slice(Math.max(0, end - count), end);
      if (!visible.length) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const h = height;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const plotW = Math.max(1, w - PAD_R);
      const plotH = h - PAD_B;
      const zonesNow = zonesRef.current;
      const linesNow = linesRef.current;

      let min = Infinity;
      let max = -Infinity;
      for (const c of visible) {
        if (c.h > max) max = c.h;
        if (c.l < min) min = c.l;
      }
      for (const z of zonesNow) {
        if (Number.isFinite(z.high)) max = Math.max(max, z.high);
        if (Number.isFinite(z.low)) min = Math.min(min, z.low);
      }
      for (const l of linesNow) {
        if (Number.isFinite(l.price)) {
          max = Math.max(max, l.price);
          min = Math.min(min, l.price);
        }
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) return;
      const pad = (max - min) * 0.08 || Math.abs(max) * 0.001 || 1;
      min -= pad;
      max += pad;
      const span = max - min || 1;
      const y = (p: number) => plotH - ((p - min) / span) * plotH;
      const cw = plotW / visible.length;
      const fmt = (p: number) => (p >= 1000 ? p.toFixed(1) : p >= 1 ? p.toFixed(3) : p.toFixed(5));

      // grid
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "10px ui-monospace, monospace";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 6; i++) {
        const py = Math.round((plotH / 6) * i) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(plotW, py);
        ctx.stroke();
        ctx.fillText(fmt(max - (span / 6) * i), plotW + 6, py + 3);
      }

      // zones
      for (const z of zonesNow) {
        const top = y(Math.max(z.low, z.high));
        const bottom = y(Math.min(z.low, z.high));
        ctx.fillStyle = z.color;
        ctx.fillRect(0, top, plotW, Math.max(2, bottom - top));
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.font = "10px ui-sans-serif, system-ui";
        ctx.fillText(z.label, 6, top - 3 < 10 ? top + 11 : top - 3);
      }

      // candles
      const bodyW = Math.max(1, cw * 0.64);
      for (let i = 0; i < visible.length; i++) {
        const c = visible[i];
        const x = Math.round(i * cw + cw / 2) + 0.5;
        const up = c.c >= c.o;
        const color = up ? "#3ddc97" : "#ff5f56";
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y(c.h));
        ctx.lineTo(x, y(c.l));
        ctx.stroke();
        const bodyTop = y(Math.max(c.o, c.c));
        const bodyH = Math.max(1, Math.abs(y(c.o) - y(c.c)));
        ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
      }

      // lines
      for (const l of linesNow) {
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
      }

      // last price tag
      const last = visible[visible.length - 1];
      const ly = y(last.c);
      ctx.fillStyle = last.c >= last.o ? "#3ddc97" : "#ff5f56";
      ctx.fillRect(plotW, ly - 8, PAD_R, 16);
      ctx.fillStyle = "#0b1220";
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.fillText(fmt(last.c), plotW + 5, ly + 3);

      // crosshair
      const hover = hoverRef.current;
      if (hover && hover.x < plotW) {
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hover.x, 0);
        ctx.lineTo(hover.x, plotH);
        ctx.moveTo(0, hover.y);
        ctx.lineTo(plotW, hover.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const p = min + ((plotH - hover.y) / plotH) * span;
        ctx.fillStyle = "rgba(0,0,0,0.8)";
        ctx.fillRect(plotW, hover.y - 8, PAD_R, 16);
        ctx.fillStyle = "#fff";
        ctx.font = "10px ui-monospace, monospace";
        ctx.fillText(fmt(p), plotW + 5, hover.y + 3);
      }
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [height]);

  // ---------- gestures ----------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let dragStart: { x: number; offset: number } | null = null;
    let pinchStart: { dist: number; count: number } | null = null;

    const zoomAt = (factor: number, clientX: number) => {
      const rect = el.getBoundingClientRect();
      const plotW = Math.max(1, rect.width - PAD_R);
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / plotW));
      const { count, offset } = viewRef.current;
      const next = Math.round(Math.min(MAX_COUNT, Math.max(MIN_COUNT, count * factor)));
      const anchorFromRight = offset + (1 - ratio) * count;
      setView(next, anchorFromRight - (1 - ratio) * next);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { count, offset } = viewRef.current;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const step = Math.sign(e.deltaX || e.deltaY) * Math.max(1, Math.round(count * 0.05));
        setView(count, offset - step);
        return;
      }
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      zoomAt(Math.exp(dy * 0.0015), e.clientX);
    };

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture?.(e.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, count: viewRef.current.count };
        dragStart = null;
      } else {
        dragStart = { x: e.clientX, offset: viewRef.current.offset };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (e.pointerType === "mouse") {
        hoverRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        dirty.current = true;
      }
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = (a.x + b.x) / 2;
        const target = pinchStart.count * (pinchStart.dist / dist);
        zoomAt(target / viewRef.current.count, mid);
        return;
      }
      if (!dragStart) return;
      e.preventDefault();
      const perCandle = Math.max(1, (rect.width - PAD_R) / viewRef.current.count);
      setView(viewRef.current.count, dragStart.offset + (e.clientX - dragStart.x) / perCandle);
    };

    const endPointer = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) dragStart = null;
      else {
        const [first] = [...pointers.values()];
        dragStart = { x: first.x, offset: viewRef.current.offset };
      }
    };

    const onLeave = () => {
      hoverRef.current = null;
      dirty.current = true;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove, { passive: false });
    el.addEventListener("pointerup", endPointer);
    el.addEventListener("pointercancel", endPointer);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endPointer);
      el.removeEventListener("pointercancel", endPointer);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const btn =
    "rounded border border-border bg-background/80 px-2 py-1 text-[11px] leading-none text-muted-foreground hover:bg-secondary active:bg-secondary";

  return (
    <div className="relative">
      <div
        ref={wrapRef}
        className="relative touch-none select-none overflow-hidden rounded-lg bg-[oklch(0.19_0.03_252)]"
        style={{ height }}
      >
        <canvas ref={canvasRef} className="block" />
        {!candles.length && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            Loading live candles…
          </div>
        )}
        <div className="absolute right-2 top-2 flex gap-1">
          <button
            className={btn}
            aria-label="Zoom in"
            onClick={() => setView(viewRef.current.count * 0.75, viewRef.current.offset)}
          >
            +
          </button>
          <button
            className={btn}
            aria-label="Zoom out"
            onClick={() => setView(viewRef.current.count * 1.35, viewRef.current.offset)}
          >
            −
          </button>
        </div>
        <div className="absolute bottom-2 left-2 flex gap-1">
          <button
            className={btn}
            aria-label="Pan left"
            onClick={() =>
              setView(
                viewRef.current.count,
                viewRef.current.offset + Math.max(1, Math.round(viewRef.current.count * 0.25)),
              )
            }
          >
            ←
          </button>
          <button
            className={btn}
            aria-label="Pan right"
            onClick={() =>
              setView(
                viewRef.current.count,
                viewRef.current.offset - Math.max(1, Math.round(viewRef.current.count * 0.25)),
              )
            }
          >
            →
          </button>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Scroll / pinch = zoom · drag = pan · {countLabel} candles</span>
        <button
          className="rounded border border-border px-2 py-0.5 hover:bg-secondary"
          onClick={() => {
            setView(140, 0);
            setCountLabel(140);
          }}
        >
          Reset view
        </button>
      </div>
    </div>
  );
}

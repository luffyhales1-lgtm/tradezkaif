import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Panel, Pill } from "@/components/ui-bits";
import { agoLabel, getLogs, subscribeLogs, type LogEvent, type LogKind } from "@/lib/bus";
import { useNow } from "@/hooks/useMarket";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/log")({
  head: () => ({
    meta: [
      { title: "Live Market Log — CoTraders" },
      {
        name: "description",
        content: "Every spoof confirmation, whale print, sweep and scanner signal streamed into one timestamped feed.",
      },
      { property: "og:title", content: "Live Market Log — CoTraders" },
      { property: "og:description", content: "Timestamped stream of every detection on CoTraders." },
    ],
  }),
  component: LogPage,
});

const KINDS: LogKind[] = ["spoof", "flow", "sweep", "signal", "whale", "paper", "alert", "system"];

const TONE: Record<LogKind, string> = {
  spoof: "border-bear/50 text-bear",
  flow: "border-primary/50 text-primary",
  sweep: "border-warn/50 text-warn",
  signal: "border-bull/50 text-bull",
  whale: "border-accent/50 text-accent",
  paper: "border-border text-muted-foreground",
  alert: "border-warn/50 text-warn",
  system: "border-border text-muted-foreground",
};

function LogPage() {
  const [events, setEvents] = useState<LogEvent[]>(getLogs());
  const [active, setActive] = useState<LogKind[]>(KINDS);
  const now = useNow(1000);

  useEffect(() => subscribeLogs(setEvents), []);

  const shown = events.filter((e) => active.includes(e.kind));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1">
        {KINDS.map((k) => (
          <button
            key={k}
            onClick={() =>
              setActive(active.includes(k) ? active.filter((x) => x !== k) : [...active, k])
            }
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-xs capitalize",
              active.includes(k) ? TONE[k] + " bg-secondary/60" : "border-border text-muted-foreground",
            )}
          >
            {k}
          </button>
        ))}
      </div>

      <Panel title="Live market log" subtitle="Everything CoTraders detects, newest first">
        <div className="max-h-[70vh] space-y-1.5 overflow-auto scroll-lock">
          {shown.map((e) => (
            <div key={e.id} className={cn("rounded-lg border bg-secondary/30 px-3 py-2", TONE[e.kind])}>
              <div className="flex items-center gap-2 text-xs">
                <Pill>{e.kind}</Pill>
                <span className="num font-semibold text-foreground">{e.symbol}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{agoLabel(e.ts, now)}</span>
              </div>
              <p className="mt-1 text-sm text-foreground">{e.text}</p>
              {e.meta && <p className="text-[11px] text-muted-foreground">{e.meta}</p>}
            </div>
          ))}
          {!shown.length && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No events yet. Open Order Flow, Spoof Radar or run a scanner — detections stream here.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}

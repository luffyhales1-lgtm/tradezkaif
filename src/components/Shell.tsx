import { Link, useRouterState } from "@tanstack/react-router";
import { Instagram, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { INSTAGRAM_URL, useAccess } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const NAV = [
  { to: "/", label: "Terminal" },
  { to: "/orderflow", label: "Order Flow" },
  { to: "/spoofing", label: "Spoof Radar" },
  { to: "/liquidity", label: "Liquidity" },
  { to: "/footprint", label: "Delta / Footprint" },
  { to: "/fib", label: "Fib · TP/SL" },
  { to: "/swing", label: "Swing Scanner" },
  { to: "/scalping", label: "Scalp Scanner" },
  { to: "/ultimate", label: "Ultimate Scanner" },
  { to: "/math", label: "Math Scanner" },
  { to: "/structure", label: "S/R Zones" },
  { to: "/whale", label: "Whale Tracker" },
  { to: "/news", label: "News" },
  { to: "/summary", label: "Market Summary" },
  { to: "/log", label: "Live Log" },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { session, logout, canAccess } = useAccess();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-display text-xl font-bold tracking-tight text-primary">
              CO<span className="text-foreground">TRADERS</span>
            </span>
            <span className="hollow-text font-display text-xs uppercase tracking-[0.3em]">
              made by kaif
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs text-primary hover:bg-primary/20"
            >
              <Instagram className="size-3.5" /> @abdul_kaif12
            </a>
            {session?.role === "admin" && (
              <Link
                to="/admin"
                className={cn(
                  "rounded-lg border border-accent/50 bg-accent/10 px-2.5 py-1.5 text-xs text-accent",
                  path === "/admin" && "bg-accent/25",
                )}
              >
                Admin Portal
              </Link>
            )}
            <button
              onClick={logout}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
            >
              <LogOut className="size-3.5" /> {session?.label ?? "Exit"}
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-3 pb-2 scroll-lock">
          {NAV.filter((n) => canAccess(n.to)).map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                path === n.to
                  ? "bg-primary/15 text-primary glow"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-5">{children}</main>
      <footer className="mx-auto flex max-w-[1600px] flex-col items-center gap-1 px-4 pb-8 pt-2 text-center text-[11px] text-muted-foreground">
        <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="text-primary">
          <Instagram className="inline size-4" />
        </a>
        <span>Get permission from admin</span>
      </footer>
    </div>
  );
}

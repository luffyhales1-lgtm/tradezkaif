import { useState } from "react";
import { Instagram, ShieldCheck } from "lucide-react";
import { INSTAGRAM_URL, useAccess } from "@/lib/auth";
import { Shell } from "@/components/Shell";
import type { ReactNode } from "react";

/** Password / admin gate rendered before any trading surface. */
export function AccessGate({ children }: { children: ReactNode }) {
  const { ready, session, loginAdmin, loginCode, requestAccess } = useAccess();
  const [tab, setTab] = useState<"code" | "admin" | "request">("code");
  const [code, setCode] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!ready) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (session) return <Shell>{children}</Shell>;

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="panel w-full max-w-md p-6">
        <div className="mb-1 text-center">
          <div className="font-display text-3xl font-bold tracking-tight text-primary">
            CO<span className="text-foreground">TRADERS</span>
          </div>
          <div className="hollow-text font-display text-[11px] uppercase tracking-[0.35em]">
            made by kaif
          </div>
        </div>
        <p className="mb-5 mt-3 text-center text-xs text-muted-foreground">
          Enter your access password or contact the admin.
        </p>

        <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-border p-1">
          {(["code", "admin", "request"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              className={`rounded px-2 py-1.5 text-xs capitalize ${tab === t ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
            >
              {t === "code" ? "Password" : t === "admin" ? "Sign in" : "Request"}
            </button>
          ))}
        </div>

        {tab === "code" && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(await loginCode(code));
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Access password"
              className="num w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground">
              Unlock terminal
            </button>
          </form>
        )}

        {tab === "admin" && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(loginAdmin(user, pass));
            }}
          >
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="Username or email"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="Password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2 text-sm font-semibold text-accent-foreground">
              <ShieldCheck className="size-4" /> Sign in
            </button>
          </form>
        )}

        {tab === "request" && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              requestAccess(email, msg);
              setSent(true);
            }}
          >
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              placeholder="Your Gmail"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="Why you need access"
              className="h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button className="w-full rounded-lg border border-primary/50 bg-primary/10 py-2 text-sm font-semibold text-primary">
              {sent ? "Request sent to admin ✓" : "Request access"}
            </button>
          </form>
        )}

        {error && <p className="mt-3 text-center text-xs text-bear">{error}</p>}

        <a
          href={INSTAGRAM_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-6 flex flex-col items-center gap-1 text-xs text-primary"
        >
          <Instagram className="size-5" />
          <span className="text-muted-foreground">Get permission from admin</span>
          <span>@abdul_kaif12</span>
        </a>
      </div>
    </div>
  );
}

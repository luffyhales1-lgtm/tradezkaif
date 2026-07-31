import { useState } from "react";
import { Instagram, LogIn, UserPlus } from "lucide-react";
import { lovable } from "@/integrations/lovable";
import { INSTAGRAM_URL, useAccess } from "@/lib/auth";
import { Shell } from "@/components/Shell";
import type { ReactNode } from "react";

/** Password / admin gate rendered before any trading surface. */
export function AccessGate({ children }: { children: ReactNode }) {
  const { ready, session, signIn, signUp, requestAccess, canAccess } = useAccess();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [pass, setPass] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (session && canAccess(window.location.pathname)) return <Shell>{children}</Shell>;

  if (session) {
    return (
      <div className="grid min-h-screen place-items-center px-4 py-10">
        <div className="panel w-full max-w-xl p-6 text-center">
          <h1 className="font-display text-2xl font-bold text-primary">Access required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This page is not included in your current subscription.
            {window.location.pathname === "/math" && " Math Scanner needs separate admin permission."}
          </p>
          <button onClick={async () => setError((await requestAccess(`Access requested for ${window.location.pathname}`)) ?? "Request sent to admin.")} className="mt-4 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Ask admin for access</button>
          {error && <p className="mt-3 text-xs text-muted-foreground">{error}</p>}
        </div>
      </div>
    );
  }

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
          Sign in with your real email. The admin activates your subscription after approval.
        </p>

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
          {(["signin", "signup"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              className={`rounded px-2 py-1.5 text-xs capitalize ${tab === t ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
            >
              {t === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        {(tab === "signin" || tab === "signup") && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(tab === "signin" ? await signIn(email, pass) : await signUp(email, pass));
              setBusy(false);
            }}
          >
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              maxLength={255}
              placeholder="Email address"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              minLength={8}
              maxLength={72}
              required
              placeholder="Password"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {tab === "signin" ? <LogIn className="size-4" /> : <UserPlus className="size-4" />}
              {busy ? "Please wait…" : tab === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
        )}

        <div className="my-3 flex items-center gap-3 text-[10px] text-muted-foreground"><span className="h-px flex-1 bg-border" />OR<span className="h-px flex-1 bg-border" /></div>
        <button onClick={async () => { const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin }); if (result.error) setError(result.error.message); }} className="w-full rounded-lg border border-border py-2 text-sm hover:bg-secondary">Continue with Google</button>

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

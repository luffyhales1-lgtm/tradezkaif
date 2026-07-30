import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Panel, Pill, Stat } from "@/components/ui-bits";
import { useAccess } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Portal — CoTraders" },
      { name: "description", content: "Issue access passwords, review requests and revoke device-bound sessions." },
      { property: "og:title", content: "Admin Portal — CoTraders" },
      { property: "og:description", content: "Access control for the CoTraders terminal." },
    ],
  }),
  component: Admin,
});

function Admin() {
  const { session, store, createKey, revokeKey, deleteKey, unbindKey, resolveRequest } = useAccess();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [custom, setCustom] = useState("");

  if (session?.role !== "admin") {
    return (
      <Panel title="Restricted">
        <p className="text-sm text-muted-foreground">
          This portal is admin-only.{" "}
          <Link to="/" className="text-primary">
            Back to terminal
          </Link>
        </p>
      </Panel>
    );
  }

  const pending = store.requests.filter((r) => r.status === "pending");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Access keys" value={store.keys.length} />
        <Stat label="Active" value={store.keys.filter((k) => !k.revoked).length} tone="bull" />
        <Stat label="Revoked" value={store.keys.filter((k) => k.revoked).length} tone="bear" />
        <Stat label="Pending requests" value={pending.length} tone="warn" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <Panel title="Issue access password" subtitle="Give this code to the person after payment">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              createKey(email, note, custom);
              setEmail("");
              setNote("");
              setCustom("");
            }}
          >
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              placeholder="User Gmail"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Custom password (optional)"
              className="num w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (friend, paid, trial…)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground">
              Create access key
            </button>
          </form>
        </Panel>

        <Panel title="Access keys" subtitle="Device and IP bound on first login">
          <div className="max-h-[520px] space-y-2 overflow-auto scroll-lock">
            {store.keys.map((k) => (
              <div
                key={k.code}
                className={cn(
                  "rounded-lg border p-3 text-xs",
                  k.revoked ? "border-bear/40 bg-bear/5" : "border-border",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num rounded bg-secondary px-2 py-0.5 font-semibold">{k.code}</span>
                  <span className="text-muted-foreground">{k.email}</span>
                  {k.revoked ? <Pill tone="bear">revoked</Pill> : <Pill tone="bull">active</Pill>}
                  {k.deviceId && <Pill tone="primary">device bound</Pill>}
                </div>
                <p className="mt-1 text-muted-foreground">
                  {k.note && `${k.note} · `}
                  {k.deviceId ? `device ${k.deviceId.slice(0, 8)} · IP ${k.ip ?? "?"}` : "not used yet"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => revokeKey(k.code)}
                    className="rounded border border-border px-2 py-1 hover:bg-secondary"
                  >
                    {k.revoked ? "Restore" : "Revoke"}
                  </button>
                  <button
                    onClick={() => unbindKey(k.code)}
                    className="rounded border border-border px-2 py-1 hover:bg-secondary"
                  >
                    Reset device / IP
                  </button>
                  <button
                    onClick={() => deleteKey(k.code)}
                    className="rounded border border-bear/50 px-2 py-1 text-bear hover:bg-bear/10"
                  >
                    Delete account
                  </button>
                </div>
              </div>
            ))}
            {!store.keys.length && (
              <p className="py-8 text-center text-muted-foreground">No keys issued yet.</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Access requests" subtitle="People who asked for permission on the login screen">
        <div className="space-y-2">
          {store.requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-xs">
              <span className="font-semibold">{r.email}</span>
              <span className="text-muted-foreground">{r.message}</span>
              <Pill tone={r.status === "approved" ? "bull" : r.status === "denied" ? "bear" : "warn"}>
                {r.status}
              </Pill>
              {r.status === "pending" && (
                <span className="ml-auto flex gap-1.5">
                  <button
                    onClick={() => {
                      createKey(r.email, "approved from request");
                      resolveRequest(r.id, "approved");
                    }}
                    className="rounded bg-primary px-2 py-1 text-primary-foreground"
                  >
                    Approve + issue key
                  </button>
                  <button
                    onClick={() => resolveRequest(r.id, "denied")}
                    className="rounded border border-border px-2 py-1"
                  >
                    Deny
                  </button>
                </span>
              )}
            </div>
          ))}
          {!store.requests.length && <p className="text-xs text-muted-foreground">No requests yet.</p>}
        </div>
      </Panel>
    </div>
  );
}

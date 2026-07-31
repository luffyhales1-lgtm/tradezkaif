import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Panel, Pill, Stat } from "@/components/ui-bits";
import { useAccess } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

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
  const { session } = useAccess();
  const [profiles, setProfiles] = useState<Tables<"profiles">[]>([]);
  const [subscriptions, setSubscriptions] = useState<Tables<"subscriptions">[]>([]);
  const [requests, setRequests] = useState<Tables<"access_requests">[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [profileResult, subscriptionResult, requestResult] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("subscriptions").select("*").order("created_at", { ascending: false }),
      supabase.from("access_requests").select("*").order("created_at", { ascending: false }),
    ]);
    setProfiles(profileResult.data ?? []);
    setSubscriptions(subscriptionResult.data ?? []);
    setRequests(requestResult.data ?? []);
  }, []);

  useEffect(() => { if (session?.role === "admin") void load(); }, [session?.role, load]);

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

  const pending = requests.filter((r) => r.status === "pending");

  const setSubscription = async (userId: string, tier: "normal" | "balanced" | "ultimate", days: number) => {
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + days * 86_400_000);
    const { error } = await supabase.from("subscriptions").upsert({ user_id: userId, tier, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), active: true }, { onConflict: "user_id" });
    if (!error) await supabase.from("profiles").update({ access_status: "active" }).eq("id", userId);
    setNotice(error?.message ?? `${tier} access activated for ${days} days.`);
    await load();
  };

  const revoke = async (userId: string) => {
    await Promise.all([
      supabase.from("profiles").update({ access_status: "revoked", device_hash: null, bound_ip: null }).eq("id", userId),
      supabase.from("subscriptions").update({ active: false }).eq("user_id", userId),
    ]);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Accounts" value={profiles.length} />
        <Stat label="Active" value={profiles.filter((p) => p.access_status === "active").length} tone="bull" />
        <Stat label="Revoked" value={profiles.filter((p) => p.access_status === "revoked").length} tone="bear" />
        <Stat label="Pending requests" value={pending.length} tone="warn" />
      </div>

      {notice && <p className="rounded border border-primary/40 bg-primary/10 p-2 text-xs text-primary">{notice}</p>}
      <Panel title="Members & subscriptions" subtitle="Activate a tier, set its duration, or revoke access immediately">
          <div className="max-h-[520px] space-y-2 overflow-auto scroll-lock">
            {profiles.map((profile) => {
              const sub = subscriptions.find((item) => item.user_id === profile.id);
              return <div key={profile.id} className="rounded-lg border border-border p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{profile.email}</span>
                  <Pill tone={profile.access_status === "active" ? "bull" : profile.access_status === "revoked" ? "bear" : "warn"}>{profile.access_status}</Pill>
                  {sub && <Pill tone="primary">{sub.tier}</Pill>}
                  {profile.device_hash && <Pill>device bound</Pill>}
                </div>
                {sub && <p className="mt-1 text-muted-foreground">Started {new Date(sub.starts_at).toLocaleDateString()} · ends {new Date(sub.ends_at).toLocaleString()}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(["normal", "balanced", "ultimate"] as const).map((tier) => <button key={tier} onClick={() => void setSubscription(profile.id, tier, 30)} className="rounded border border-border px-2 py-1 capitalize hover:bg-secondary">{tier} · 30d</button>)}
                  <button onClick={() => void supabase.from("user_page_permissions").upsert({ user_id: profile.id, page_key: "/math", allowed: true }, { onConflict: "user_id,page_key" }).then(() => setNotice("Math Scanner access granted."))} className="rounded border border-accent/50 px-2 py-1 text-accent">Grant Math</button>
                  <button onClick={() => void revoke(profile.id)} className="rounded border border-bear/50 px-2 py-1 text-bear">Revoke</button>
                </div>
              </div>;
            })}
            {!profiles.length && <p className="py-8 text-center text-muted-foreground">No registered members yet.</p>}
          </div>
      </Panel>

      <Panel title="Access requests" subtitle="People who asked for permission on the login screen">
        <div className="space-y-2">
          {requests.map((r) => (
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
                      void supabase.from("access_requests").update({ status: "approved" }).eq("id", r.id).then(load);
                    }}
                    className="rounded bg-primary px-2 py-1 text-primary-foreground"
                  >
                    Approve + issue key
                  </button>
                  <button
                    onClick={() => void supabase.from("access_requests").update({ status: "denied" }).eq("id", r.id).then(load)}
                    className="rounded border border-border px-2 py-1"
                  >
                    Deny
                  </button>
                </span>
              )}
            </div>
          ))}
          {!requests.length && <p className="text-xs text-muted-foreground">No requests yet.</p>}
        </div>
      </Panel>
    </div>
  );
}

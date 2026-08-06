import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const INSTAGRAM_URL = "https://www.instagram.com/abdul_kaif12/";
export type SubscriptionTier = "normal" | "balanced" | "ultimate";
export type AccessState = {
  user: User;
  role: "admin" | "user";
  label: string;
  accessStatus: string;
  subscription: { tier: SubscriptionTier; startsAt: string; endsAt: string; active: boolean } | null;
  permissions: Record<string, boolean>;
};

type Ctx = {
  ready: boolean;
  session: AccessState | null;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  requestAccess: (message: string) => Promise<string | null>;
  logout: () => Promise<void>;
  canAccess: (page: string) => boolean;
};

const AccessContext = createContext<Ctx | null>(null);

const TIER_PAGES: Record<SubscriptionTier, string[]> = {
  normal: ["/", "/orderflow", "/news"],
  balanced: ["/", "/orderflow", "/news", "/liquidity", "/spoofing"],
  ultimate: ["/", "/orderflow", "/news", "/liquidity", "/spoofing", "/footprint", "/fib", "/swing", "/scalping", "/ultimate", "/forex", "/structure", "/whale", "/summary", "/log"],
};

export function AccessProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AccessState | null>(null);
  const [clock, setClock] = useState(0);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) { setSession(null); setReady(true); return; }
    const [profileResult, roleResult, subscriptionResult, permissionResult] = await Promise.all([
      supabase.from("profiles").select("email, display_name, access_status").eq("id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
      supabase.from("subscriptions").select("tier, starts_at, ends_at, active").eq("user_id", user.id).maybeSingle(),
      supabase.from("user_page_permissions").select("page_key, allowed").eq("user_id", user.id),
    ]);
    const profile = profileResult.data;
    const sub = subscriptionResult.data;
    setSession({
      user,
      role: roleResult.data?.some((row) => row.role === "admin") ? "admin" : "user",
      label: profile?.display_name || profile?.email || user.email || "Member",
      accessStatus: profile?.access_status ?? "pending",
      subscription: sub ? { tier: sub.tier, startsAt: sub.starts_at, endsAt: sub.ends_at, active: sub.active } : null,
      permissions: Object.fromEntries((permissionResult.data ?? []).map((row) => [row.page_key, row.allowed])),
    });
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) void refresh();
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  useEffect(() => {
    if (!session?.subscription?.active) return;
    const timer = setInterval(() => setClock((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [session?.subscription?.active, session?.subscription?.endsAt]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (!error) await refresh();
    return error?.message ?? null;
  }, [refresh]);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
    if (error) return error.message;
    return data.session ? null : "Check your email to confirm your account, then sign in.";
  }, []);

  const requestAccess = useCallback(async (message: string) => {
    if (!session?.user.email) return "Sign in before requesting access.";
    const { error } = await supabase.from("access_requests").insert({ user_id: session.user.id, email: session.user.email, message: message.trim().slice(0, 1000) });
    return error?.message ?? null;
  }, [clock, session]);

  const logout = useCallback(async () => { await supabase.auth.signOut(); setSession(null); }, []);

  const canAccess = useCallback((page: string) => {
    if (!session) return false;
    if (session.role === "admin") return true;
    if (page === "/math") return session.permissions[page] === true;
    if (page in session.permissions) return session.permissions[page];
    const sub = session.subscription;
    if (session.accessStatus !== "active" || !sub?.active || new Date(sub.endsAt).getTime() <= Date.now()) return false;
    return TIER_PAGES[sub.tier].includes(page);
  }, [session]);

  const value = useMemo(
    () => ({
      ready,
      session,
      refresh,
      signIn,
      signUp,
      logout,
      requestAccess,
      canAccess,
    }),
    [
      ready,
      session,
      refresh,
      signIn,
      signUp,
      logout,
      requestAccess,
      canAccess,
    ],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error("useAccess must be used inside AccessProvider");
  return ctx;
}


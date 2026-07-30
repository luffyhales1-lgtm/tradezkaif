/**
 * Local access control: admin account, issued access passwords,
 * device/IP binding and access requests. Stored in localStorage —
 * front-end gate only; swap to Lovable Cloud for server-enforced auth.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const ADMIN_USERNAME = "admin";
export const ADMIN_EMAIL = "admin@cotraders.app";
const ADMIN_PASSWORD = "admin";

export type AccessKey = {
  code: string;
  email: string;
  note: string;
  createdAt: number;
  revoked: boolean;
  deviceId?: string;
  ip?: string;
  boundAt?: number;
  lastSeen?: number;
};

export type AccessRequest = {
  id: string;
  email: string;
  message: string;
  createdAt: number;
  status: "pending" | "approved" | "denied";
};

export type Session = { role: "admin" | "user"; label: string; code?: string } | null;

type Store = { keys: AccessKey[]; requests: AccessRequest[] };

const STORE_KEY = "cotraders.access.store";
const SESSION_KEY = "cotraders.session";
const DEVICE_KEY = "cotraders.device";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

export function getDeviceId() {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

async function getIp() {
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    const j = (await r.json()) as { ip: string };
    return j.ip;
  } catch {
    return "unknown";
  }
}

type Ctx = {
  ready: boolean;
  session: Session;
  store: Store;
  loginAdmin: (user: string, pass: string) => string | null;
  loginCode: (code: string) => Promise<string | null>;
  logout: () => void;
  createKey: (email: string, note: string, code?: string) => AccessKey;
  revokeKey: (code: string) => void;
  deleteKey: (code: string) => void;
  unbindKey: (code: string) => void;
  requestAccess: (email: string, message: string) => void;
  resolveRequest: (id: string, status: "approved" | "denied") => void;
};

const AccessContext = createContext<Ctx | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session>(null);
  const [store, setStore] = useState<Store>({ keys: [], requests: [] });

  useEffect(() => {
    setStore(read<Store>(STORE_KEY, { keys: [], requests: [] }));
    setSession(read<Session>(SESSION_KEY, null));
    setReady(true);
  }, []);

  const persist = useCallback((next: Store) => {
    setStore(next);
    write(STORE_KEY, next);
  }, []);

  const loginAdmin = useCallback((user: string, pass: string) => {
    const ok =
      (user.trim().toLowerCase() === ADMIN_USERNAME ||
        user.trim().toLowerCase() === ADMIN_EMAIL) &&
      pass === ADMIN_PASSWORD;
    if (!ok) return "Invalid admin credentials.";
    const s: Session = { role: "admin", label: "Admin" };
    setSession(s);
    write(SESSION_KEY, s);
    return null;
  }, []);

  const loginCode = useCallback(
    async (code: string) => {
      const current = read<Store>(STORE_KEY, store);
      const key = current.keys.find((k) => k.code === code.trim());
      if (!key) return "Password not recognised. Contact the admin on Instagram.";
      if (key.revoked) return "This access key has been revoked by the admin.";
      const device = getDeviceId();
      if (key.deviceId && key.deviceId !== device) {
        return "This key is locked to another device. Ask the admin to reset it.";
      }
      const ip = await getIp();
      const next: Store = {
        ...current,
        keys: current.keys.map((k) =>
          k.code === key.code
            ? {
                ...k,
                deviceId: k.deviceId ?? device,
                ip: k.ip ?? ip,
                boundAt: k.boundAt ?? Date.now(),
                lastSeen: Date.now(),
              }
            : k,
        ),
      };
      persist(next);
      const s: Session = { role: "user", label: key.email || "Member", code: key.code };
      setSession(s);
      write(SESSION_KEY, s);
      return null;
    },
    [persist, store],
  );

  const logout = useCallback(() => {
    setSession(null);
    write(SESSION_KEY, null);
  }, []);

  const createKey = useCallback(
    (email: string, note: string, code?: string) => {
      const key: AccessKey = {
        code: code?.trim() || `CT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        email,
        note,
        createdAt: Date.now(),
        revoked: false,
      };
      persist({ ...store, keys: [key, ...store.keys] });
      return key;
    },
    [persist, store],
  );

  const revokeKey = useCallback(
    (code: string) =>
      persist({
        ...store,
        keys: store.keys.map((k) => (k.code === code ? { ...k, revoked: !k.revoked } : k)),
      }),
    [persist, store],
  );

  const deleteKey = useCallback(
    (code: string) => persist({ ...store, keys: store.keys.filter((k) => k.code !== code) }),
    [persist, store],
  );

  const unbindKey = useCallback(
    (code: string) =>
      persist({
        ...store,
        keys: store.keys.map((k) =>
          k.code === code ? { ...k, deviceId: undefined, ip: undefined, boundAt: undefined } : k,
        ),
      }),
    [persist, store],
  );

  const requestAccess = useCallback(
    (email: string, message: string) => {
      const current = read<Store>(STORE_KEY, store);
      const req: AccessRequest = {
        id: `${Date.now()}`,
        email,
        message,
        createdAt: Date.now(),
        status: "pending",
      };
      persist({ ...current, requests: [req, ...current.requests] });
    },
    [persist, store],
  );

  const resolveRequest = useCallback(
    (id: string, status: "approved" | "denied") =>
      persist({
        ...store,
        requests: store.requests.map((r) => (r.id === id ? { ...r, status } : r)),
      }),
    [persist, store],
  );

  const value = useMemo(
    () => ({
      ready,
      session,
      store,
      loginAdmin,
      loginCode,
      logout,
      createKey,
      revokeKey,
      deleteKey,
      unbindKey,
      requestAccess,
      resolveRequest,
    }),
    [
      ready,
      session,
      store,
      loginAdmin,
      loginCode,
      logout,
      createKey,
      revokeKey,
      deleteKey,
      unbindKey,
      requestAccess,
      resolveRequest,
    ],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const ctx = useContext(AccessContext);
  if (!ctx) throw new Error("useAccess must be used inside AccessProvider");
  return ctx;
}

export const INSTAGRAM_URL = "https://www.instagram.com/abdul_kaif12/";

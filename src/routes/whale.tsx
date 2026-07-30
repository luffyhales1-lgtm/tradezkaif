import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Panel, Pill, Stat } from "@/components/ui-bits";
import { fmtPrice, fmtUsd } from "@/lib/binance";
import { pushLog } from "@/lib/bus";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/whale")({
  head: () => ({
    meta: [
      { title: "Whale Tracker — Hyperliquid Accounts — CoTraders" },
      {
        name: "description",
        content: "Live Hyperliquid whale accounts: open positions, entry zones, leverage, unrealised PnL and resting orders.",
      },
      { property: "og:title", content: "Whale Tracker — CoTraders" },
      { property: "og:description", content: "Track 12 Hyperliquid whale wallets in real time." },
    ],
  }),
  component: Whale,
});

const WALLETS = [
  "0x3bcae23e8c380dab4732e9a159c0456f12d866f3",
  "0x89e2c2bac76c4804c4a57661039fbc35338159c2",
  "0x4c6d679eac539bf7c5a0b7ebd8949ae93b1e5ee9",
  "0xd67ca2c6f8bc84acf4fa4472b82a8740dc0a53ff",
  "0xaf0fdd39e5d92499b0ed9f68693da99c0ec1e92e",
  "0xc3fd3b216da68ca76fe4a860419c761c39d6dec2",
  "0x50b309f78e774a756a2230e1769729094cac9f20",
  "0xf25e42f86b463bc51a4bb1a5a42eed77b36e5130",
  "0x6859da14835424957a1e6b397d8026b1d9ff7e1e",
  "0x76097a1d0d8f5e93930719c231e793375eb960d9",
  "0x0871deb34bfd2052b1c10dc4f6c0912a2a47e927",
  "0x53babe76166eae33c861aeddf9ce89af20311cd0",
];

type Position = {
  coin: string;
  size: number;
  entry: number;
  notional: number;
  pnl: number;
  leverage: number;
  liq: number | null;
};

type Account = {
  address: string;
  equity: number;
  positions: Position[];
  orders: { coin: string; side: string; price: number; size: number }[];
  error?: string;
  loading: boolean;
};

async function hl<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HL ${res.status}`);
  return (await res.json()) as T;
}

async function loadAccount(address: string): Promise<Account> {
  try {
    const [state, open] = await Promise.all([
      hl<{
        marginSummary: { accountValue: string };
        assetPositions: {
          position: {
            coin: string;
            szi: string;
            entryPx: string;
            positionValue: string;
            unrealizedPnl: string;
            leverage: { value: number };
            liquidationPx: string | null;
          };
        }[];
      }>({ type: "clearinghouseState", user: address }),
      hl<{ coin: string; side: string; limitPx: string; sz: string }[]>({
        type: "openOrders",
        user: address,
      }),
    ]);
    return {
      address,
      loading: false,
      equity: Number(state.marginSummary?.accountValue ?? 0),
      positions: (state.assetPositions ?? []).map((p) => ({
        coin: p.position.coin,
        size: Number(p.position.szi),
        entry: Number(p.position.entryPx),
        notional: Number(p.position.positionValue),
        pnl: Number(p.position.unrealizedPnl),
        leverage: p.position.leverage?.value ?? 0,
        liq: p.position.liquidationPx ? Number(p.position.liquidationPx) : null,
      })),
      orders: (open ?? []).map((o) => ({
        coin: o.coin,
        side: o.side === "B" ? "buy" : "sell",
        price: Number(o.limitPx),
        size: Number(o.sz),
      })),
    };
  } catch (e) {
    return { address, loading: false, equity: 0, positions: [], orders: [], error: (e as Error).message };
  }
}

function Whale() {
  const [accounts, setAccounts] = useState<Account[]>(
    WALLETS.map((a) => ({ address: a, equity: 0, positions: [], orders: [], loading: true })),
  );
  const [selected, setSelected] = useState(0);

  const refresh = async () => {
    setAccounts((a) => a.map((x) => ({ ...x, loading: true })));
    const loaded = await Promise.all(WALLETS.map(loadAccount));
    setAccounts(loaded);
    loaded.forEach((a, i) => {
      a.positions
        .filter((p) => Math.abs(p.notional) > 500_000)
        .forEach((p) =>
          pushLog({
            kind: "whale",
            symbol: p.coin,
            text: `Whale ${i + 1} ${p.size > 0 ? "LONG" : "SHORT"} ${p.coin} ${fmtUsd(Math.abs(p.notional))}`,
            meta: `entry ${fmtPrice(p.entry)} · ${p.leverage}x · PnL ${fmtUsd(p.pnl)}`,
          }),
        );
    });
  };

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acc = accounts[selected];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {accounts.map((a, i) => (
            <button
              key={a.address}
              onClick={() => setSelected(i)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs",
                i === selected
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary",
              )}
            >
              Whale {i + 1}
            </button>
          ))}
        </div>
        <button
          onClick={refresh}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          Refresh all accounts
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Account equity" value={acc?.loading ? "…" : fmtUsd(acc?.equity ?? 0)} />
        <Stat label="Open positions" value={acc?.positions.length ?? 0} />
        <Stat label="Resting orders" value={acc?.orders.length ?? 0} />
        <Stat
          label="Unrealised PnL"
          value={fmtUsd(acc?.positions.reduce((s, p) => s + p.pnl, 0) ?? 0)}
          tone={(acc?.positions.reduce((s, p) => s + p.pnl, 0) ?? 0) >= 0 ? "bull" : "bear"}
        />
      </div>

      <Panel
        title={`Whale ${selected + 1}`}
        subtitle={acc?.address}
        right={acc?.loading ? <Pill tone="warn">loading</Pill> : <Pill tone="bull">live</Pill>}
      >
        {acc?.error && <p className="text-xs text-bear">Hyperliquid error: {acc.error}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Positions</h3>
            <div className="space-y-1.5">
              {acc?.positions.map((p) => (
                <div key={p.coin} className="rounded-lg border border-border p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="num font-semibold">{p.coin}</span>
                    <Pill tone={p.size > 0 ? "bull" : "bear"}>{p.size > 0 ? "long" : "short"}</Pill>
                    <span className="num">{fmtUsd(Math.abs(p.notional))}</span>
                    <span className={cn("num", p.pnl >= 0 ? "text-bull" : "text-bear")}>{fmtUsd(p.pnl)}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Entry {fmtPrice(p.entry)} · {p.leverage}x · Liq {p.liq ? fmtPrice(p.liq) : "—"}
                  </p>
                </div>
              ))}
              {!acc?.positions.length && !acc?.loading && (
                <p className="text-xs text-muted-foreground">No open positions on this wallet.</p>
              )}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Limit orders</h3>
            <div className="max-h-72 space-y-1 overflow-auto scroll-lock text-xs">
              {acc?.orders.map((o, i) => (
                <div key={i} className="flex justify-between rounded border border-border px-2 py-1">
                  <span className="num">{o.coin}</span>
                  <span className={o.side === "buy" ? "text-bull" : "text-bear"}>{o.side}</span>
                  <span className="num">{fmtPrice(o.price)}</span>
                  <span className="num">{o.size}</span>
                </div>
              ))}
              {!acc?.orders.length && !acc?.loading && (
                <p className="text-muted-foreground">No resting orders.</p>
              )}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, Pill } from "@/components/ui-bits";
import { agoLabel, pushLog } from "@/lib/bus";
import { useNow } from "@/hooks/useMarket";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/news")({
  head: () => ({
    meta: [
      { title: "Live Market News — Crypto, Forex & Stocks — CoTraders" },
      {
        name: "description",
        content: "Live crypto, forex and macro headlines with market impact labels and Roman Urdu explainers.",
      },
      { property: "og:title", content: "Live Market News — CoTraders" },
      { property: "og:description", content: "Headlines labelled positive or negative for the market." },
    ],
  }),
  component: News,
});

type Item = {
  title: string;
  link: string;
  ts: number;
  source: string;
  category: "crypto" | "forex" | "stocks" | "macro";
};

const FEEDS: { url: string; source: string; category: Item["category"] }[] = [
  { url: "https://cointelegraph.com/rss", source: "Cointelegraph", category: "crypto" },
  { url: "https://www.newsbtc.com/feed/", source: "NewsBTC", category: "crypto" },
  { url: "https://cryptopotato.com/feed/", source: "CryptoPotato", category: "crypto" },
  { url: "https://bitcoinist.com/feed/", source: "Bitcoinist", category: "crypto" },
  { url: "https://www.fxstreet.com/rss/news", source: "FXStreet", category: "forex" },
  { url: "https://www.investing.com/rss/news_25.rss", source: "Investing FX", category: "forex" },
  { url: "https://finance.yahoo.com/news/rssindex", source: "Yahoo Finance", category: "stocks" },
  { url: "https://www.investing.com/rss/news_14.rss", source: "Investing Economy", category: "macro" },
];

const POSITIVE = ["surge", "rally", "soar", "gain", "jump", "record", "approval", "bullish", "beat", "inflow", "upgrade", "cut", "adopt", "breakout", "high"];
const NEGATIVE = ["crash", "plunge", "fall", "drop", "slump", "hack", "ban", "lawsuit", "bearish", "miss", "outflow", "selloff", "liquidat", "hike", "exploit", "warn", "low"];

function sentiment(title: string) {
  const t = title.toLowerCase();
  const pos = POSITIVE.filter((w) => t.includes(w)).length;
  const neg = NEGATIVE.filter((w) => t.includes(w)).length;
  if (pos > neg) return "positive" as const;
  if (neg > pos) return "negative" as const;
  return "neutral" as const;
}

/** Headline-specific Roman Urdu explainer (built from the actual words in the headline). */
function romanUrdu(item: Item) {
  const s = sentiment(item.title);
  const t = item.title.toLowerCase();
  const asset = t.includes("bitcoin") || t.includes("btc")
    ? "Bitcoin"
    : t.includes("ethereum") || t.includes("eth")
      ? "Ethereum"
      : t.includes("fed") || t.includes("rate")
        ? "Fed policy"
        : t.includes("dollar") || t.includes("usd")
          ? "Dollar"
          : item.category === "crypto"
            ? "Crypto market"
            : item.category === "forex"
              ? "Forex market"
              : "Stock market";
  const impact =
    s === "positive"
      ? `${asset} ke liye ye khabar acchi hai — buyers ko support mil sakta hai, dips buy karne wale active honge.`
      : s === "negative"
        ? `${asset} ke liye ye khabar negative hai — selling pressure barh sakta hai, long positions mein risk zyada hai.`
        : `${asset} par abhi mixed asar hai — market wait and watch mode mein reh sakta hai.`;
  return `${item.source} se khabar: "${item.title}". ${impact}`;
}

type Rss2JsonItem = { title?: string; link?: string; pubDate?: string };

/** Primary: rss2json (CORS-enabled JSON). Fallback: raw XML through a proxy. */
async function fetchFeed(
  url: string,
  source: string,
  category: Item["category"],
  signal: AbortSignal,
): Promise<Item[]> {
  const toTs = (d?: string) => {
    const parsed = d ? Date.parse(d.includes("T") ? d : d.replace(" ", "T") + "Z") : NaN;
    return Number.isNaN(parsed) ? Date.now() : parsed;
  };

  try {
    const res = await fetch(
      `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}&_=${Date.now()}`,
      { signal, cache: "no-store" },
    );
    if (res.ok) {
      const json = (await res.json()) as { status?: string; items?: Rss2JsonItem[] };
      if (json.status === "ok" && json.items?.length) {
        return json.items.slice(0, 20).map((n) => ({
          title: (n.title ?? "").trim(),
          link: n.link ?? "#",
          ts: toTs(n.pubDate),
          source,
          category,
        }));
      }
    }
  } catch {
    /* fall through to proxy */
  }

  const res = await fetch(
    `https://corsproxy.io/?url=${encodeURIComponent(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`)}`,
    { signal, cache: "no-store" },
  );

  if (!res.ok) throw new Error(`${source} ${res.status}`);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  return [...doc.querySelectorAll("item, entry")].slice(0, 20).map((n) => {
    const linkEl = n.querySelector("link");
    return {
      title: n.querySelector("title")?.textContent?.trim() ?? "",
      link: linkEl?.textContent?.trim() || linkEl?.getAttribute("href") || "#",
      ts: toTs(
        n.querySelector("pubDate")?.textContent ??
          n.querySelector("updated")?.textContent ??
          n.querySelector("published")?.textContent ??
          undefined,
      ),
      source,
      category,
    };
  });
}

function News() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Item["category"]>("all");
  const [errors, setErrors] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState(0);
  const seen = useRef(new Set<string>());
  const now = useNow(1000);

  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;

    const load = async () => {
      const results = await Promise.allSettled(
        FEEDS.map((f) => fetchFeed(f.url, f.source, f.category, ctrl.signal)),
      );
      if (!alive) return;
      const ok = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      setErrors(
        results
          .map((r, i) => (r.status === "rejected" ? FEEDS[i].source : null))
          .filter((x): x is string => Boolean(x)),
      );
      const merged = new Map<string, Item>();
      ok.filter((i) => i.title).forEach((i) => merged.set(i.title, i));
      const list = [...merged.values()].sort((a, b) => b.ts - a.ts).slice(0, 120);
      setItems(list);
      setLastSync(Date.now());
      setLoading(false);

      // Stream fresh headlines into the Live Log.
      list.slice(0, 12).forEach((i) => {
        if (seen.current.has(i.title) || Date.now() - i.ts > 30 * 60_000) return;
        seen.current.add(i.title);
        const s = sentiment(i.title);
        pushLog({
          kind: "alert",
          symbol: i.category.toUpperCase(),
          text: `${s === "positive" ? "BULLISH" : s === "negative" ? "BEARISH" : "NEUTRAL"} NEWS · ${i.title}`,
          meta: `${i.source} · ${romanUrdu(i).split(". ").slice(1).join(". ")}`,
          ts: i.ts,
        });
      });
      if (seen.current.size > 600) seen.current.clear();
    };

    void load();
    const id = setInterval(() => void load(), 45_000);
    return () => {
      alive = false;
      ctrl.abort();
      clearInterval(id);
    };
  }, []);

  const shown = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.category === filter)),
    [items, filter],
  );
  const freshest = items[0]?.ts ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(["all", "crypto", "forex", "stocks", "macro"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs capitalize",
                filter === c ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", loading ? "bg-warn" : "bg-bull animate-pulse")} />
            {loading ? "syncing…" : "live"}
          </span>
          {!!lastSync && <span className="num">synced {agoLabel(lastSync, now)}</span>}
          {!!freshest && <span className="num">newest {agoLabel(freshest, now)}</span>}
          <span className="num">auto-refresh 45s</span>
        </div>
      </div>

      {errors.length > 0 && (
        <p className="text-[11px] text-warn">
          Feed unavailable right now: {errors.join(", ")} — other sources still streaming.
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((item, i) => {
          const s = sentiment(item.title);
          const fresh = now - item.ts < 15 * 60_000;
          return (
            <Panel key={`${item.link}-${i}`}>
              <div className="mb-2 flex items-center gap-2">
                <Pill tone={s === "positive" ? "bull" : s === "negative" ? "bear" : "default"}>
                  {s === "positive" ? "market positive" : s === "negative" ? "market negative" : "neutral"}
                </Pill>
                <Pill>{item.category}</Pill>
                {fresh && <Pill tone="primary">new</Pill>}
                <span className="ml-auto text-[11px] text-muted-foreground">{agoLabel(item.ts, now)}</span>
              </div>
              <a href={item.link} target="_blank" rel="noreferrer" className="text-sm font-medium hover:text-primary">
                {item.title}
              </a>
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">{romanUrdu(item)}</p>
            </Panel>
          );
        })}
        {!shown.length && !loading && (
          <Panel>
            <p className="text-sm text-muted-foreground">No headlines in this category yet.</p>
          </Panel>
        )}
      </div>
    </div>
  );
}

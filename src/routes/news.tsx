import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "@/components/ui-bits";
import { agoLabel } from "@/lib/bus";
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
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk", category: "crypto" },
  { url: "https://cointelegraph.com/rss", source: "Cointelegraph", category: "crypto" },
  { url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", source: "WSJ Markets", category: "stocks" },
  { url: "https://www.fxstreet.com/rss/news", source: "FXStreet", category: "forex" },
  { url: "https://finance.yahoo.com/news/rssindex", source: "Yahoo Finance", category: "macro" },
];

const POSITIVE = ["surge", "rally", "soar", "gain", "jump", "record", "approval", "bullish", "beat", "inflow", "upgrade", "cut"];
const NEGATIVE = ["crash", "plunge", "fall", "drop", "slump", "hack", "ban", "lawsuit", "bearish", "miss", "outflow", "selloff", "liquidat", "hike"];

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

async function fetchFeed(url: string, source: string, category: Item["category"]): Promise<Item[]> {
  const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxy);
  if (!res.ok) throw new Error(`${source} ${res.status}`);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  return [...doc.querySelectorAll("item, entry")].slice(0, 15).map((n) => {
    const title = n.querySelector("title")?.textContent?.trim() ?? "";
    const linkEl = n.querySelector("link");
    const link = linkEl?.textContent?.trim() || linkEl?.getAttribute("href") || "#";
    const dateText =
      n.querySelector("pubDate")?.textContent ??
      n.querySelector("updated")?.textContent ??
      n.querySelector("published")?.textContent ??
      "";
    return { title, link, ts: dateText ? Date.parse(dateText) : Date.now(), source, category };
  });
}

function News() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Item["category"]>("all");
  const [errors, setErrors] = useState<string[]>([]);
  const now = useNow(5000);

  const load = async () => {
    setLoading(true);
    const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f.url, f.source, f.category)));
    const ok = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    setErrors(
      results
        .map((r, i) => (r.status === "rejected" ? FEEDS[i].source : null))
        .filter((x): x is string => Boolean(x)),
    );
    setItems(ok.filter((i) => i.title).sort((a, b) => b.ts - a.ts).slice(0, 80));
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, []);

  const shown = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.category === filter)),
    [items, filter],
  );

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
        <button
          onClick={load}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          {loading ? "Refreshing…" : "Refresh feed"}
        </button>
      </div>

      {errors.length > 0 && (
        <p className="text-[11px] text-warn">
          Feed unavailable right now: {errors.join(", ")} — other sources still streaming.
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((item, i) => {
          const s = sentiment(item.title);
          return (
            <Panel key={`${item.link}-${i}`}>
              <div className="mb-2 flex items-center gap-2">
                <Pill tone={s === "positive" ? "bull" : s === "negative" ? "bear" : "default"}>
                  {s === "positive" ? "market positive" : s === "negative" ? "market negative" : "neutral"}
                </Pill>
                <Pill>{item.category}</Pill>
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

import { createServerFn } from "@tanstack/react-start";
import { fetchFxCandles } from "@/lib/forex.server";

export const getFxCandles = createServerFn({ method: "GET" })
  .inputValidator((input: { symbol: string; interval: string; limit?: number }) => input)
  .handler(async ({ data }) =>
    fetchFxCandles(data.symbol, data.interval, Math.min(1000, data.limit ?? 300)),
  );

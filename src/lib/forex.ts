/** Forex + metals universe (client-safe metadata only). */
export type FxInstrument = { symbol: string; yahoo: string; label: string; digits: number };

export const FX_INSTRUMENTS: FxInstrument[] = [
  // Majors
  { symbol: "EURUSD", yahoo: "EURUSD=X", label: "Euro / US Dollar", digits: 5 },
  { symbol: "GBPUSD", yahoo: "GBPUSD=X", label: "Pound / US Dollar", digits: 5 },
  { symbol: "USDJPY", yahoo: "USDJPY=X", label: "US Dollar / Yen", digits: 3 },
  { symbol: "USDCHF", yahoo: "USDCHF=X", label: "US Dollar / Franc", digits: 5 },
  { symbol: "USDCAD", yahoo: "USDCAD=X", label: "US Dollar / Loonie", digits: 5 },
  { symbol: "AUDUSD", yahoo: "AUDUSD=X", label: "Aussie / US Dollar", digits: 5 },
  { symbol: "NZDUSD", yahoo: "NZDUSD=X", label: "Kiwi / US Dollar", digits: 5 },
  // Crosses
  { symbol: "EURGBP", yahoo: "EURGBP=X", label: "Euro / Pound", digits: 5 },
  { symbol: "EURJPY", yahoo: "EURJPY=X", label: "Euro / Yen", digits: 3 },
  { symbol: "GBPJPY", yahoo: "GBPJPY=X", label: "Pound / Yen", digits: 3 },
  { symbol: "AUDJPY", yahoo: "AUDJPY=X", label: "Aussie / Yen", digits: 3 },
  { symbol: "CHFJPY", yahoo: "CHFJPY=X", label: "Franc / Yen", digits: 3 },
  { symbol: "CADJPY", yahoo: "CADJPY=X", label: "Loonie / Yen", digits: 3 },
  { symbol: "NZDJPY", yahoo: "NZDJPY=X", label: "Kiwi / Yen", digits: 3 },
  { symbol: "EURAUD", yahoo: "EURAUD=X", label: "Euro / Aussie", digits: 5 },
  { symbol: "EURCHF", yahoo: "EURCHF=X", label: "Euro / Franc", digits: 5 },
  { symbol: "EURCAD", yahoo: "EURCAD=X", label: "Euro / Loonie", digits: 5 },
  { symbol: "EURNZD", yahoo: "EURNZD=X", label: "Euro / Kiwi", digits: 5 },
  { symbol: "GBPAUD", yahoo: "GBPAUD=X", label: "Pound / Aussie", digits: 5 },
  { symbol: "GBPCAD", yahoo: "GBPCAD=X", label: "Pound / Loonie", digits: 5 },
  { symbol: "GBPCHF", yahoo: "GBPCHF=X", label: "Pound / Franc", digits: 5 },
  { symbol: "GBPNZD", yahoo: "GBPNZD=X", label: "Pound / Kiwi", digits: 5 },
  { symbol: "AUDCAD", yahoo: "AUDCAD=X", label: "Aussie / Loonie", digits: 5 },
  { symbol: "AUDCHF", yahoo: "AUDCHF=X", label: "Aussie / Franc", digits: 5 },
  { symbol: "AUDNZD", yahoo: "AUDNZD=X", label: "Aussie / Kiwi", digits: 5 },
  { symbol: "CADCHF", yahoo: "CADCHF=X", label: "Loonie / Franc", digits: 5 },
  { symbol: "NZDCAD", yahoo: "NZDCAD=X", label: "Kiwi / Loonie", digits: 5 },
  { symbol: "NZDCHF", yahoo: "NZDCHF=X", label: "Kiwi / Franc", digits: 5 },
  // Emerging / exotics
  { symbol: "USDMXN", yahoo: "USDMXN=X", label: "US Dollar / Peso", digits: 4 },
  { symbol: "USDZAR", yahoo: "USDZAR=X", label: "US Dollar / Rand", digits: 4 },
  { symbol: "USDTRY", yahoo: "USDTRY=X", label: "US Dollar / Lira", digits: 4 },
  { symbol: "USDINR", yahoo: "USDINR=X", label: "US Dollar / Rupee", digits: 3 },
  { symbol: "USDSGD", yahoo: "USDSGD=X", label: "US Dollar / SG Dollar", digits: 5 },
  { symbol: "USDSEK", yahoo: "USDSEK=X", label: "US Dollar / Krona", digits: 4 },
  { symbol: "USDNOK", yahoo: "USDNOK=X", label: "US Dollar / Krone", digits: 4 },
  // Metals & dollar index
  { symbol: "XAUUSD", yahoo: "GC=F", label: "Gold spot-equivalent", digits: 2 },
  { symbol: "XAGUSD", yahoo: "SI=F", label: "Silver", digits: 3 },
  { symbol: "XPTUSD", yahoo: "PL=F", label: "Platinum", digits: 2 },
  { symbol: "XPDUSD", yahoo: "PA=F", label: "Palladium", digits: 2 },
  { symbol: "XCUUSD", yahoo: "HG=F", label: "Copper", digits: 4 },
  { symbol: "DXY", yahoo: "DX-Y.NYB", label: "US Dollar Index", digits: 3 },
];

const byName = new Map(FX_INSTRUMENTS.map((i) => [i.symbol, i]));

export const fxLabel = (symbol: string) => byName.get(symbol)?.label ?? symbol;

/** Price formatter that respects each instrument's pip precision. */
export const fmtFx = (n: number) =>
  n >= 500 ? n.toFixed(2) : n >= 20 ? n.toFixed(3) : n.toFixed(5);

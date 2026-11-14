/**
 * Pure rules for Chambelli's control of Amazon listings: report parsing, margin math,
 * stock limits and Seller Central upload files. No database or network access.
 */

export const MARKETPLACES = ["US", "CA", "MX"] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

const CURRENCY: Record<Marketplace, string> = { US: "USD", CA: "CAD", MX: "MXN" };

export interface AmazonSettings {
  marketplace: Marketplace;
  currency: string;
  /** CJ warehouse country stock is counted from (Canada sells Canadian stock, and so on). */
  stockCountry: string;
  /** USD to marketplace currency rate for CJ costs (1 for the US). Null = price checks off. */
  usdRate: number | null;
  /** What CJ charges to ship one unit, in the marketplace currency. Null = price checks off. */
  shippingCost: number | null;
  /** Target margin on the item price after Amazon fees and costs, in percent. */
  marginPercent: number;
  /** Amazon referral fee, in percent of the item price. */
  referralFeePercent: number;
  /** Never list more than this many units, even when CJ has more. */
  maxQuantity: number;
  /** Units held back from CJ's stock so Amazon never oversells. */
  stockBuffer: number;
  /** CJ shipping method used when ordering from CJ (e.g. "USPS+"). Null = ordering off. */
  cjLogistic: string | null;
}

export function isMarketplace(v: unknown): v is Marketplace {
  return typeof v === "string" && (MARKETPLACES as readonly string[]).includes(v);
}

/**
 * Settings for one marketplace from AMAZON_<US|CA|MX>_* environment values.
 * Anything not set keeps a safe default; money checks stay off until costs are known.
 */
export function settingsFromEnv(
  env: Record<string, string | undefined>,
  marketplace: Marketplace = "US",
): AmazonSettings {
  const v = (k: string) => {
    const x = env[`AMAZON_${marketplace}_${k}`];
    return x === undefined || x.trim() === "" ? undefined : x.trim();
  };
  const num = (x: string | undefined, d: number) =>
    x !== undefined && Number.isFinite(Number(x)) ? Number(x) : d;
  const optNum = (x: string | undefined) =>
    x !== undefined && Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : null;
  const rate = marketplace === "US" ? 1 : optNum(v("USD_RATE"));
  return {
    marketplace,
    currency: CURRENCY[marketplace],
    stockCountry: (v("STOCK_COUNTRY") ?? marketplace).toUpperCase(),
    usdRate: rate && rate > 0 ? rate : null,
    shippingCost: optNum(v("SHIPPING_COST")),
    marginPercent: num(v("MIN_MARGIN_PERCENT"), 30),
    referralFeePercent: num(v("REFERRAL_FEE_PERCENT"), 15),
    maxQuantity: num(v("MAX_QUANTITY"), 10),
    stockBuffer: num(v("STOCK_BUFFER"), 2),
    cjLogistic: v("CJ_LOGISTIC") ?? null,
  };
}

export interface ReportRow {
  sellerSku: string;
  asin: string | null;
  title: string;
  price: number | null;
  quantity: number | null;
  status: string | null;
}

/**
 * Parses Seller Central's "All Listings Report" (tab-separated, first row is the header).
 * Columns are found by name, so Amazon reordering them does not matter.
 */
export function parseAllListingsReport(text: string): ReportRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iSku = col("seller-sku", "sku");
  if (iSku < 0) throw new Error("REPORT_MISSING_SELLER_SKU");
  const iAsin = col("asin1", "asin");
  const iTitle = col("item-name", "title");
  const iPrice = col("price");
  const iQty = col("quantity");
  const iStatus = col("status");
  const cell = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
  const numOrNull = (v: string) => (v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  return lines.slice(1).flatMap((line) => {
    const cells = line.split("\t");
    const sellerSku = cell(cells, iSku);
    if (!sellerSku) return [];
    return [
      {
        sellerSku,
        asin: cell(cells, iAsin) || null,
        title: cell(cells, iTitle) || sellerSku,
        price: numOrNull(cell(cells, iPrice)),
        quantity: numOrNull(cell(cells, iQty)),
        status: cell(cells, iStatus) || null,
      },
    ];
  });
}

/** Love$Care seller SKUs are "LC-" + the CJ SKU. Returns null when it is not a CJ item. */
export function cjSkuFromSellerSku(sellerSku: string): string | null {
  const s = sellerSku.trim().replace(/^LC-/i, "");
  return /^CJ[A-Z0-9-]+$/i.test(s) ? s.toUpperCase() : null;
}

/**
 * Lowest item price that keeps the margin after the referral fee:
 * price >= (cost + shipping) / (1 - (margin + fee) / 100), rounded up to the cent.
 */
export function minimumPrice(cost: number, shipping: number, s: AmazonSettings): number {
  const share = (s.marginPercent + s.referralFeePercent) / 100;
  if (!(cost > 0) || !(shipping >= 0)) throw new Error("INVALID_COST");
  if (share <= 0 || share >= 1) throw new Error("INVALID_MARGIN_RULE");
  return Math.ceil(((cost + shipping) / (1 - share)) * 100 - 1e-9) / 100;
}

/** Rounds a price up to the next .99 ending (12.30 -> 12.99, 12.99 -> 12.99). */
export function priceEnding99(price: number): number {
  const whole = Math.floor(price);
  const candidate = whole + 0.99;
  return Number((candidate + 1e-9 >= price ? candidate : whole + 1.99).toFixed(2));
}

export type ListingAlert =
  | "CJ_SKU_MISSING"
  | "CJ_SKU_NOT_FOUND"
  | "OUT_OF_STOCK"
  | "LOW_STOCK"
  | "BELOW_MARGIN"
  | "PRICE_RAISE_OVER_10_PERCENT"
  | "SHIPPING_COST_NOT_SET"
  | "FX_RATE_NOT_SET";

export interface ListingPlan {
  /** Quantity to set on Amazon, or null to leave Amazon's quantity alone. */
  targetQuantity: number | null;
  minPrice: number | null;
  /** New Amazon price, or null to keep the current one. */
  newPrice: number | null;
  alerts: ListingAlert[];
}

/**
 * Decides what Amazon should show for one listing, given CJ's stock in the marketplace's
 * warehouse country and CJ's cost (USD).
 * Never lowers a price, never zeroes a listing because a SKU could not be matched,
 * and only raises a price when it would otherwise sell below the margin.
 */
export function planListing(
  current: { price: number | null; cjSku: string | null },
  cj: { stock: number | null; cost: number | null },
  s: AmazonSettings,
): ListingPlan {
  const alerts: ListingAlert[] = [];
  if (!current.cjSku) return { targetQuantity: null, minPrice: null, newPrice: null, alerts: ["CJ_SKU_MISSING"] };
  if (cj.stock === null && cj.cost === null)
    return { targetQuantity: null, minPrice: null, newPrice: null, alerts: ["CJ_SKU_NOT_FOUND"] };

  let targetQuantity: number | null = null;
  if (cj.stock !== null) {
    const sellable = Math.max(0, cj.stock - s.stockBuffer);
    targetQuantity = Math.min(sellable, s.maxQuantity);
    if (targetQuantity === 0) alerts.push("OUT_OF_STOCK");
    else if (targetQuantity < 3) alerts.push("LOW_STOCK");
  }

  let minPrice: number | null = null;
  let newPrice: number | null = null;
  if (s.usdRate === null) alerts.push("FX_RATE_NOT_SET");
  else if (s.shippingCost === null) alerts.push("SHIPPING_COST_NOT_SET");
  else if (cj.cost !== null && cj.cost > 0) {
    minPrice = minimumPrice(Math.round(cj.cost * s.usdRate * 100) / 100, s.shippingCost, s);
    if (current.price === null || current.price < minPrice) {
      newPrice = priceEnding99(minPrice);
      if (current.price !== null) alerts.push("BELOW_MARGIN");
      if (current.price !== null && newPrice > current.price * 1.1)
        alerts.push("PRICE_RAISE_OVER_10_PERCENT");
    }
  }
  return { targetQuantity, minPrice, newPrice, alerts };
}

const tsvCell = (v: unknown) =>
  v === null || v === undefined ? "" : String(v).replace(/[\t\r\n]+/g, " ").trim();
const tsv = (rows: unknown[][]) => rows.map((r) => r.map(tsvCell).join("\t")).join("\n") + "\n";

/**
 * Seller Central "Price and Quantity" upload file. Upload it at
 * Catalog > Add Products via Upload > Upload your inventory file.
 * Rows with nothing to change are left out; a blank price keeps Amazon's price.
 */
export function priceQuantityFile(
  rows: Array<{ sellerSku: string; newPrice: number | null; quantity: number | null }>,
): string {
  const header = [
    "sku",
    "price",
    "minimum-seller-allowed-price",
    "maximum-seller-allowed-price",
    "quantity",
    "handling-time",
    "fulfillment-channel",
  ];
  const body = rows
    .filter((r) => r.newPrice !== null || r.quantity !== null)
    .map((r) => [r.sellerSku, r.newPrice?.toFixed(2) ?? "", "", "", r.quantity ?? "", "", ""]);
  return tsv([header, ...body]);
}

/** Up to five Amazon bullet points taken from a CJ description (HTML stripped). */
export function bulletsFromDescription(description: string | null | undefined): string[] {
  if (!description) return [];
  const text = description
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  return text
    .split(/\n|(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 12)
    .slice(0, 5)
    .map((s) => (s.length > 250 ? s.slice(0, 247).trimEnd() + "..." : s));
}

/** Amazon titles are capped at 200 characters. */
export function cleanTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length > 200 ? t.slice(0, 200).replace(/\s+\S*$/, "") : t;
}

/**
 * Approved new listings with everything needed to fill Amazon's category upload template:
 * SKU, title, price, quantity, five bullets, description and real CJ product photos.
 */
export function newListingsFile(
  rows: Array<{
    sellerSku: string;
    title: string;
    price: number | null;
    quantity: number | null;
    bullets: string[];
    description: string | null;
    imageUrls: string[];
  }>,
): string {
  const header = [
    "sku",
    "title",
    "price",
    "quantity",
    "bullet_point1",
    "bullet_point2",
    "bullet_point3",
    "bullet_point4",
    "bullet_point5",
    "description",
    "main_image_url",
    "other_image_url1",
    "other_image_url2",
    "other_image_url3",
  ];
  const body = rows.map((r) => [
    r.sellerSku,
    r.title,
    r.price?.toFixed(2) ?? "",
    r.quantity ?? "",
    ...Array.from({ length: 5 }, (_, i) => r.bullets[i] ?? ""),
    r.description ?? "",
    ...Array.from({ length: 4 }, (_, i) => r.imageUrls[i] ?? ""),
  ]);
  return tsv([header, ...body]);
}

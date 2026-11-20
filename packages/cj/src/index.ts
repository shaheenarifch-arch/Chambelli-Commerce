import { z } from "zod";

const CJItem = z.object({
  pid: z.string(),
  productSku: z.string().nullish(),
  productNameEn: z.string().nullish(),
  productImage: z.string().nullish(),
  sellPrice: z.union([z.string(), z.number()]).nullish(),
  categoryId: z.string().nullish(),
  categoryName: z.string().nullish(),
});
export type CJItem = z.infer<typeof CJItem>;

// One row of CJ's My Product List (the "Added Products" page in the CJ dashboard).
const MyProduct = z.object({
  productId: z.string(),
  sku: z.string().nullish(),
  nameEn: z.string().nullish(),
  productName: z.string().nullish(),
  bigImage: z.string().nullish(),
  sellPrice: z.union([z.string(), z.number()]).nullish(),
});

/**
 * CJ prices arrive as numbers, numeric strings, or ranges such as "1.20-3.40".
 * Returns the lowest price in the value, or 0 when nothing usable is present.
 */
export function parseCJPrice(value: string | number | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  if (!value) return 0;
  const nums = (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0);
  return nums.length ? Math.min(...nums) : 0;
}

export interface ProductFilter {
  /** Keyword search on the English product name. */
  productNameEn?: string;
  /** Warehouse country, e.g. "US" for USA-warehouse stock. */
  countryCode?: string;
}

interface CJCategoryNode {
  categoryFirstId?: string;
  categoryFirstName?: string;
  categoryFirstList?: Array<{
    categorySecondId?: string;
    categorySecondName?: string;
    categorySecondList?: Array<{ categoryId?: string; categoryName?: string }>;
  }>;
}
export type CJCategoryTree = CJCategoryNode[];

/** Compare category names loosely: "Home, Garden & Furniture" == "home garden and furniture". */
export function normalizeCategory(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Map every CJ category id (any level) to its top-level category name. */
export function topCategoryIndex(tree: CJCategoryTree): Map<string, string> {
  const index = new Map<string, string>();
  for (const first of tree) {
    const top = first.categoryFirstName?.trim();
    if (!top) continue;
    if (first.categoryFirstId) index.set(first.categoryFirstId, top);
    for (const second of first.categoryFirstList ?? []) {
      if (second.categorySecondId) index.set(second.categorySecondId, top);
      for (const third of second.categorySecondList ?? []) {
        if (third.categoryId) index.set(third.categoryId, top);
      }
    }
  }
  return index;
}

export interface SiteMapEntry {
  slug: string;
  name: string;
  domain: string;
  cjCategories: string[];
  terms: string[];
  /**
   * Which market the site sells to: "US" (default, CJ US warehouse, USD) or "UK" (CJ UK
   * warehouse, GBP). UK sites only get products from the UK sync and need titleMatch words.
   */
  market?: "US" | "UK";
  /** When set, a product title must contain one of these words (e.g. "safe" for firearmsafety.us). */
  titleMatch?: string[];
  /** Never link a product whose title contains one of these words. */
  titleExclude?: string[];
}
export interface SiteMap {
  /** Most products per site carousel (50). */
  productsPerSite: number;
  /** Fewest products a site should have; the dashboard flags sites below it (30). */
  minProductsPerSite?: number;
  /**
   * Words whose products belong to one site only, e.g. { "shorts": "shopdress" }: every other
   * site treats the word as a titleExclude. Help: docs/CJ-SITE-MAP.md
   */
  onlyOnSite?: Record<string, string>;
  sites: SiteMapEntry[];
}

/** Adds each onlyOnSite word to the titleExclude list of every other site. */
export function applyOnlyOnSite(map: SiteMap): SiteMap {
  const rules = Object.entries(map.onlyOnSite ?? {});
  if (!rules.length) return map;
  return {
    ...map,
    sites: map.sites.map((s) => {
      const extra = rules.filter(([, slug]) => slug !== s.slug).map(([word]) => word);
      return extra.length ? { ...s, titleExclude: [...(s.titleExclude ?? []), ...extra] } : s;
    }),
  };
}

/**
 * True when the title contains the word (or phrase) as a whole word, plurals included:
 * "safe" matches "Gun Safe" and "2 Safes" but not "Safety Pad"; "pill" no longer matches
 * "pillow" and "brace" no longer matches "bracelet". Help: docs/CJ-SITE-MAP.md
 */
export function hasWord(title: string, word: string): boolean {
  const w = word.trim().toLowerCase();
  if (!w) return false;
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "party" also matches "parties"; other words also match "-s" and "-es" plurals.
  const body = w.endsWith("y") ? `(?:${esc}s?|${esc.slice(0, -1)}ies)` : `${esc}(?:s|es)?`;
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`).test(title.toLowerCase());
}

/** True when a product title passes a site's titleMatch / titleExclude rules (whole words). */
export function titleFitsSite(
  title: string,
  site: Pick<SiteMapEntry, "titleMatch" | "titleExclude">,
): boolean {
  if (site.titleExclude?.some((w) => hasWord(title, w))) return false;
  if (site.titleMatch?.length) return site.titleMatch.some((w) => hasWord(title, w));
  return true;
}

/** Sites that a product in this CJ top-level category should be offered to. */
export function sitesForCategory(map: SiteMap, topCategory: string): SiteMapEntry[] {
  const want = normalizeCategory(topCategory);
  return map.sites.filter((s) => s.cjCategories.some((c) => normalizeCategory(c) === want));
}

/** Options for listing products held in one country's warehouses (for example CA for Canada). */
export interface CJListOptions {
  /** Two-letter warehouse country, e.g. "CA". Only products with stock there are returned. */
  countryCode?: string;
  /** Smallest warehouse stock to include (inclusive). */
  minInventory?: number;
}

const CJInventory = z.object({
  countryCode: z.string().nullish(),
  totalInventory: z.union([z.number(), z.string()]).nullish(),
});
const CJProductDetail = z.object({
  variants: z
    .array(z.object({ inventories: z.array(CJInventory).nullish() }).passthrough())
    .nullish(),
});

/**
 * Sum the stock a CJ product detail reports for one warehouse country.
 * Returns 0 when the detail has no inventory for that country.
 */
export function countryStock(detail: unknown, countryCode: string): number {
  const parsed = CJProductDetail.safeParse(detail);
  if (!parsed.success) return 0;
  const code = countryCode.toUpperCase();
  let total = 0;
  for (const v of parsed.data.variants ?? []) {
    for (const inv of v.inventories ?? []) {
      if ((inv.countryCode ?? "").toUpperCase() !== code) continue;
      const n = Number(inv.totalInventory ?? 0);
      if (Number.isFinite(n) && n > 0) total += Math.floor(n);
    }
  }
  return total;
}

const CJWarehouse = z.object({
  countryCode: z.string().nullish(),
  totalInventoryNum: z.union([z.number(), z.string()]).nullish(),
});

/** Add up CJ stock per warehouse country from a /product/stock/queryBySku response. */
export function warehouseTotals(data: unknown): Record<string, number> {
  const rows = z.array(CJWarehouse).safeParse(Array.isArray(data) ? data : []);
  const totals: Record<string, number> = {};
  if (!rows.success) return totals;
  for (const r of rows.data) {
    const code = (r.countryCode ?? "").toUpperCase();
    const n = Number(r.totalInventoryNum ?? 0);
    if (!code || !Number.isFinite(n) || n <= 0) continue;
    totals[code] = (totals[code] ?? 0) + Math.floor(n);
  }
  return totals;
}

/**
 * Stock per warehouse country from a /product/stock/getInventoryByPid response.
 * Uses the product-level `inventories` list: CJ's per-variant inventories (in /product/query)
 * often leave out the US warehouse, which made every US product look out of stock.
 */
export function inventoryByPidTotals(data: unknown): Record<string, number> {
  const list = (data as { inventories?: unknown } | null)?.inventories;
  return warehouseTotals(Array.isArray(list) ? list : []);
}

export interface CJOrderResult {
  orderId: string;
  orderStatus: string | null;
  amountUsd: number | null;
}

export interface CJVariantInfo {
  vid: string;
  pid: string | null;
  sku: string;
  name: string;
  image: string | null;
  /** CJ price in USD. */
  cost: number;
}

const CJVariant = z.object({
  vid: z.string(),
  pid: z.string().nullish(),
  variantSku: z.string().nullish(),
  variantNameEn: z.string().nullish(),
  variantImage: z.string().nullish(),
  variantSellPrice: z.union([z.number(), z.string()]).nullish(),
});

/** First usable variant from a /product/variant/query response. */
export function firstVariant(data: unknown): CJVariantInfo | null {
  const rows = z.array(CJVariant).safeParse(Array.isArray(data) ? data : []);
  if (!rows.success) return null;
  for (const v of rows.data) {
    const cost = parseCJPrice(v.variantSellPrice ?? undefined);
    if (cost > 0)
      return {
        vid: v.vid,
        pid: v.pid ?? null,
        sku: v.variantSku ?? "",
        name: v.variantNameEn ?? "",
        image: v.variantImage ?? null,
        cost,
      };
  }
  return null;
}

export interface CJProductInfo {
  title: string;
  description: string | null;
  images: string[];
}

const CJProduct = z.object({
  productNameEn: z.string().nullish(),
  description: z.string().nullish(),
  productImage: z.string().nullish(),
  productImageSet: z.union([z.array(z.string()), z.string()]).nullish(),
});

/** Title, description and real product photos from a /product/query response. */
export function productInfo(data: unknown): CJProductInfo | null {
  const p = CJProduct.safeParse(data);
  if (!p.success || !p.data.productNameEn) return null;
  let images: string[] = [];
  const set = p.data.productImageSet;
  if (Array.isArray(set)) images = set;
  else if (typeof set === "string") {
    try {
      const parsed: unknown = JSON.parse(set);
      if (Array.isArray(parsed)) images = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      images = set.split(",").map((x) => x.trim());
    }
  }
  if (p.data.productImage && !images.includes(p.data.productImage))
    images.unshift(p.data.productImage);
  return {
    title: p.data.productNameEn,
    description: p.data.description ?? null,
    images: images.filter((u) => /^https?:\/\//.test(u)).slice(0, 8),
  };
}

export class CJConnector {
  constructor(
    private token: string,
    private baseUrl: string,
  ) {
    if (!baseUrl) throw new Error("CJ_API_BASE_URL_REQUIRED");
  }

  private async get(path: string): Promise<unknown> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      headers: { "CJ-Access-Token": this.token },
    });
    if (!r.ok) throw new Error(`CJ_HTTP_${r.status}`);
    const body = (await r.json()) as { result?: boolean; message?: string; data?: unknown };
    if (body.result === false) throw new Error(`CJ_API_ERROR: ${body.message ?? "unknown"}`);
    return body.data;
  }

  /** Stock CJ holds for a product in one warehouse country (e.g. "CA"). */
  async warehouseStock(pid: string, countryCode: string): Promise<number> {
    const code = countryCode.toUpperCase();
    try {
      // Product-level stock per warehouse (GET /product/stock/getInventoryByPid).
      const totals = inventoryByPidTotals(
        await this.get(`/product/stock/getInventoryByPid?${new URLSearchParams({ pid })}`),
      );
      return totals[code] ?? 0;
    } catch {
      // Fallback: per-variant inventories from the product detail.
      const q = new URLSearchParams({ pid, countryCode: code });
      return countryStock(await this.get(`/product/query?${q}`), code);
    }
  }

  /**
   * Creates a CJ order (POST /shopping/order/createOrderV2). With payType 3 the order is
   * created unpaid, to be paid in the CJ dashboard.
   */
  async createOrder(payload: Record<string, unknown>): Promise<CJOrderResult> {
    const r = await fetch(`${this.baseUrl}/shopping/order/createOrderV2`, {
      method: "POST",
      headers: { "CJ-Access-Token": this.token, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`CJ_HTTP_${r.status}`);
    const body = (await r.json()) as {
      result?: boolean;
      message?: string;
      data?: { orderId?: string; orderStatus?: string; orderAmount?: number | string };
    };
    if (body.result === false || !body.data?.orderId)
      throw new Error(`CJ_API_ERROR: ${body.message ?? "no order id returned"}`);
    const amount = Number(body.data.orderAmount);
    return {
      orderId: body.data.orderId,
      orderStatus: body.data.orderStatus ?? null,
      amountUsd: Number.isFinite(amount) ? amount : null,
    };
  }

  /**
   * Stock per warehouse country for a CJ SKU, e.g. { US: 120, CN: 5000 }.
   * Empty when CJ does not know the SKU.
   */
  async stockBySku(sku: string): Promise<Record<string, number>> {
    const data = await this.get(`/product/stock/queryBySku?${new URLSearchParams({ sku })}`);
    return warehouseTotals(data);
  }

  /** A CJ product's title, description and photos, or null when unknown. */
  async productByPid(pid: string): Promise<CJProductInfo | null> {
    return productInfo(await this.get(`/product/query?${new URLSearchParams({ pid })}`));
  }

  /** A CJ variant's cost (USD), name and image, or null when the SKU is unknown. */
  async variantBySku(sku: string): Promise<CJVariantInfo | null> {
    const data = await this.get(
      `/product/variant/query?${new URLSearchParams({ variantSku: sku })}`,
    );
    return firstVariant(data);
  }

  async listProducts(
    pageNum = 1,
    pageSize = 100,
    opts: CJListOptions & ProductFilter = {},
  ): Promise<CJItem[]> {
    const q = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(pageSize) });
    if (opts.productNameEn) q.set("productNameEn", opts.productNameEn);
    if (opts.countryCode) q.set("countryCode", opts.countryCode.toUpperCase());
    if (opts.minInventory !== undefined) q.set("startInventory", String(opts.minInventory));
    const data = (await this.get(`/product/list?${q}`)) as
      { list?: unknown } | unknown[] | undefined;
    const raw = Array.isArray(data) ? data : ((data as { list?: unknown })?.list ?? []);
    return z.array(CJItem).parse(raw);
  }

  /**
   * One page of the account's "Added Products" (CJ: My Product List, GET /product/myProduct/query),
   * shaped like catalog items. That endpoint has no category, so categoryId is looked up later.
   */
  async myProducts(pageNum = 1, pageSize = 100): Promise<CJItem[]> {
    const q = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(pageSize) });
    const data = (await this.get(`/product/myProduct/query?${q}`)) as
      { content?: unknown; list?: unknown } | unknown[] | undefined;
    const raw = Array.isArray(data)
      ? data
      : ((data as { content?: unknown; list?: unknown })?.content ??
        (data as { list?: unknown })?.list ??
        []);
    return z
      .array(MyProduct)
      .parse(raw)
      .map((p) => ({
        pid: p.productId,
        productSku: p.sku ?? undefined,
        productNameEn: p.nameEn ?? p.productName ?? undefined,
        productImage: p.bigImage ?? undefined,
        sellPrice: p.sellPrice ?? undefined,
      }));
  }

  /** Every page of "Added Products", one request per second (CJ's limit). */
  async *allMyProducts(pageSize = 100, maxPages = 20, delayMs = 1100): AsyncGenerator<CJItem[]> {
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await new Promise((r) => setTimeout(r, delayMs));
      const items = await this.myProducts(page, pageSize);
      if (items.length) yield items;
      if (items.length < pageSize) return;
    }
  }

  /** A product's CJ category id from /product/query, or null when unknown. */
  async categoryIdByPid(pid: string): Promise<string | null> {
    const data = (await this.get(`/product/query?${new URLSearchParams({ pid })}`)) as
      { categoryId?: unknown } | undefined;
    return typeof data?.categoryId === "string" ? data.categoryId : null;
  }

  /** CJ's category tree (top level such as "Women's Clothing", then two sub-levels). */
  async getCategories(): Promise<CJCategoryTree> {
    const r = await fetch(`${this.baseUrl}/product/getCategory`, {
      headers: { "CJ-Access-Token": this.token },
    });
    if (!r.ok) throw new Error(`CJ_HTTP_${r.status}`);
    const body = (await r.json()) as { result?: boolean; message?: string; data?: unknown };
    if (body.result === false) throw new Error(`CJ_API_ERROR: ${body.message ?? "unknown"}`);
    return Array.isArray(body.data) ? (body.data as CJCategoryTree) : [];
  }

  /**
   * Walk every page until a short page or the page cap is reached, pausing
   * between requests to respect CJ's limit of one request per second.
   */
  async *allProducts(
    pageSize = 100,
    maxPages = 50,
    delayMs = 1100,
    opts: CJListOptions = {},
  ): AsyncGenerator<CJItem[]> {
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await new Promise((r) => setTimeout(r, delayMs));
      const items = await this.listProducts(page, pageSize, opts);
      if (items.length) yield items;
      if (items.length < pageSize) return;
    }
  }
}

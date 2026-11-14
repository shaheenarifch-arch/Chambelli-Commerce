import { z } from "zod";

const CJItem = z.object({
  pid: z.string(),
  productSku: z.string().optional(),
  productNameEn: z.string().optional(),
  productImage: z.string().optional(),
  sellPrice: z.union([z.string(), z.number()]).optional(),
});
export type CJItem = z.infer<typeof CJItem>;

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

/** Options for listing products held in one country's warehouses (for example CA for Canada). */
export interface CJListOptions {
  /** Two-letter warehouse country, e.g. "CA". Only products with stock there are returned. */
  countryCode?: string;
  /** Smallest warehouse stock to include (inclusive). */
  minInventory?: number;
}

const CJInventory = z.object({
  countryCode: z.string().optional(),
  totalInventory: z.union([z.number(), z.string()]).optional(),
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
    const q = new URLSearchParams({ pid, countryCode: countryCode.toUpperCase() });
    return countryStock(await this.get(`/product/query?${q}`), countryCode);
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
    const data = await this.get(`/product/variant/query?${new URLSearchParams({ variantSku: sku })}`);
    return firstVariant(data);
  }

  async listProducts(pageNum = 1, pageSize = 100, opts: CJListOptions = {}): Promise<CJItem[]> {
    const q = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(pageSize) });
    if (opts.countryCode) q.set("countryCode", opts.countryCode.toUpperCase());
    if (opts.minInventory !== undefined) q.set("startInventory", String(opts.minInventory));
    const data = (await this.get(`/product/list?${q}`)) as
      { list?: unknown } | unknown[] | undefined;
    const raw = Array.isArray(data) ? data : ((data as { list?: unknown })?.list ?? []);
    return z.array(CJItem).parse(raw);
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

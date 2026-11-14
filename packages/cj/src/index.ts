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

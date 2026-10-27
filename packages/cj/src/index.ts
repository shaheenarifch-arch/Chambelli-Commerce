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

export class CJConnector {
  constructor(
    private token: string,
    private baseUrl: string,
  ) {
    if (!baseUrl) throw new Error("CJ_API_BASE_URL_REQUIRED");
  }

  async listProducts(pageNum = 1, pageSize = 100): Promise<CJItem[]> {
    const r = await fetch(`${this.baseUrl}/product/list?pageNum=${pageNum}&pageSize=${pageSize}`, {
      headers: { "CJ-Access-Token": this.token },
    });
    if (!r.ok) throw new Error(`CJ_HTTP_${r.status}`);
    const body = (await r.json()) as { result?: boolean; message?: string; data?: unknown };
    if (body.result === false) throw new Error(`CJ_API_ERROR: ${body.message ?? "unknown"}`);
    const data = body.data as { list?: unknown } | unknown[] | undefined;
    const raw = Array.isArray(data) ? data : ((data as { list?: unknown })?.list ?? []);
    return z.array(CJItem).parse(raw);
  }

  /**
   * Walk every page until a short page or the page cap is reached, pausing
   * between requests to respect CJ's limit of one request per second.
   */
  async *allProducts(pageSize = 100, maxPages = 50, delayMs = 1100): AsyncGenerator<CJItem[]> {
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await new Promise((r) => setTimeout(r, delayMs));
      const items = await this.listProducts(page, pageSize);
      if (items.length) yield items;
      if (items.length < pageSize) return;
    }
  }
}

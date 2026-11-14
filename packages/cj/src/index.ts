import { z } from "zod";

const CJItem = z.object({
  pid: z.string(),
  productSku: z.string().optional(),
  productNameEn: z.string().optional(),
  productImage: z.string().optional(),
  sellPrice: z.union([z.string(), z.number()]).optional(),
  categoryId: z.string().optional(),
  categoryName: z.string().optional(),
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
}
export interface SiteMap {
  productsPerSite: number;
  sites: SiteMapEntry[];
}

/** Sites that a product in this CJ top-level category should be offered to. */
export function sitesForCategory(map: SiteMap, topCategory: string): SiteMapEntry[] {
  const want = normalizeCategory(topCategory);
  return map.sites.filter((s) => s.cjCategories.some((c) => normalizeCategory(c) === want));
}

export class CJConnector {
  constructor(
    private token: string,
    private baseUrl: string,
  ) {
    if (!baseUrl) throw new Error("CJ_API_BASE_URL_REQUIRED");
  }

  async listProducts(pageNum = 1, pageSize = 100, filter: ProductFilter = {}): Promise<CJItem[]> {
    const q = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(pageSize) });
    if (filter.productNameEn) q.set("productNameEn", filter.productNameEn);
    if (filter.countryCode) q.set("countryCode", filter.countryCode);
    const r = await fetch(`${this.baseUrl}/product/list?${q}`, {
      headers: { "CJ-Access-Token": this.token },
    });
    if (!r.ok) throw new Error(`CJ_HTTP_${r.status}`);
    const body = (await r.json()) as { result?: boolean; message?: string; data?: unknown };
    if (body.result === false) throw new Error(`CJ_API_ERROR: ${body.message ?? "unknown"}`);
    const data = body.data as { list?: unknown } | unknown[] | undefined;
    const raw = Array.isArray(data) ? data : ((data as { list?: unknown })?.list ?? []);
    return z.array(CJItem).parse(raw);
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
  async *allProducts(pageSize = 100, maxPages = 50, delayMs = 1100): AsyncGenerator<CJItem[]> {
    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await new Promise((r) => setTimeout(r, delayMs));
      const items = await this.listProducts(page, pageSize);
      if (items.length) yield items;
      if (items.length < pageSize) return;
    }
  }
}

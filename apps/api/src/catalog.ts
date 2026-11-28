import { readFile } from "node:fs/promises";
import { db, ProductStatus } from "@chambelli/database";
import { CAROUSEL_MAX_PRICE } from "@chambelli/feeds";
import { cleanSupplierNotes } from "@chambelli/cj";

/**
 * chambelli.com catalog: every live carousel product for one market, sorted into departments.
 * Departments come from config/departments.json. Help: docs/CHAMBELLI-COM.md
 */

export interface Department {
  slug: string;
  name: string;
  sites: string[];
  categories: string[];
}
export interface DepartmentMap {
  fallback: string;
  departments: Department[];
}

/** chambelli.com path → Chambelli market, currency and the path of its product pages. */
export const CATALOG_MARKETS = {
  us: { market: "US", currency: "USD", productPath: "us" },
  uk: { market: "UK", currency: "GBP", productPath: "uk" },
  eu: { market: "DE", currency: "EUR", productPath: "de" },
  ca: { market: "CA", currency: "CAD", productPath: "ca" },
} as const;
export type CatalogMarketKey = keyof typeof CATALOG_MARKETS;

export interface CatalogProduct {
  id: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  price: number;
  compareAtPrice: number | null;
  currency: string;
  department: string;
  /** The carousel site the product is sold through (passed to the product page as ?site=). */
  site: string;
}

export interface Catalog {
  market: CatalogMarketKey;
  currency: string;
  productPath: string;
  departments: Array<{ slug: string; name: string; count: number }>;
  products: CatalogProduct[];
  updatedAt: string;
}

/**
 * Department for one product: the first listed site it is live on decides; if none of its
 * sites is listed (mixed sites such as coupondepots), its CJ category decides; else fallback.
 */
export function resolveDepartment(
  siteSlugs: string[],
  category: string,
  map: DepartmentMap,
): string {
  for (const d of map.departments) if (siteSlugs.some((s) => d.sites.includes(s))) return d.slug;
  const cat = category.trim().toLowerCase();
  for (const d of map.departments)
    if (d.categories.some((c) => c.toLowerCase() === cat)) return d.slug;
  return map.fallback;
}

const MAP_URL = new URL("../../../config/departments.json", import.meta.url);
let mapCache: DepartmentMap | null = null;
export async function loadDepartmentMap(): Promise<DepartmentMap> {
  if (mapCache) return mapCache;
  const raw = JSON.parse(await readFile(MAP_URL, "utf8")) as DepartmentMap;
  mapCache = { fallback: raw.fallback, departments: raw.departments };
  return mapCache;
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<CatalogMarketKey, { at: number; data: Catalog }>();

export async function getCatalog(key: CatalogMarketKey): Promise<Catalog> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const m = CATALOG_MARKETS[key];
  const map = await loadDepartmentMap();
  const now = new Date();
  const variantWhere = {
    active: true,
    quantity: { gt: 0 },
    currency: m.currency,
    price: { lte: CAROUSEL_MAX_PRICE },
  };
  const rows = await db.productAssignment.findMany({
    where: {
      active: true,
      website: { active: true, market: m.market },
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
      product: { status: ProductStatus.ACTIVE, variants: { some: variantWhere } },
    },
    include: {
      website: { select: { slug: true } },
      product: {
        include: {
          variants: { where: variantWhere, orderBy: { price: "asc" }, take: 1 },
          score: { select: { finalScore: true } },
        },
      },
    },
    orderBy: [{ priority: "desc" }],
  });

  // One entry per product, remembering every site it is live on in this market.
  const byId = new Map<
    string,
    { product: (typeof rows)[number]["product"]; sites: string[]; score: number }
  >();
  for (const r of rows) {
    const seen = byId.get(r.productId);
    if (seen) {
      if (!seen.sites.includes(r.website.slug)) seen.sites.push(r.website.slug);
      continue;
    }
    byId.set(r.productId, {
      product: r.product,
      sites: [r.website.slug],
      score: Number(r.product.score?.finalScore ?? 0),
    });
  }

  const products: CatalogProduct[] = [];
  for (const { product, sites, score } of [...byId.values()].sort((a, b) => b.score - a.score)) {
    const v = product.variants[0];
    if (!v) continue;
    const department = resolveDepartment(sites, product.category, map);
    // Link through a site whose department matches, so the product page shows the right store.
    const dept = map.departments.find((d) => d.slug === department);
    const site = sites.find((s) => dept?.sites.includes(s)) ?? sites[0]!;
    products.push({
      id: product.id,
      slug: product.slug,
      title: cleanSupplierNotes(product.title),
      imageUrl: product.imageUrl,
      price: Number(v.price),
      compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : null,
      currency: v.currency,
      department,
      site,
    });
  }

  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.department, (counts.get(p.department) ?? 0) + 1);
  const data: Catalog = {
    market: key,
    currency: m.currency,
    productPath: m.productPath,
    departments: map.departments.map((d) => ({
      slug: d.slug,
      name: d.name,
      count: counts.get(d.slug) ?? 0,
    })),
    products,
    updatedAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** For tests: forget cached catalogs and the department map. */
export function clearCatalogCache() {
  cache.clear();
  mapCache = null;
}

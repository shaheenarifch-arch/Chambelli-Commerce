import cron from "node-cron";
import { readFile } from "node:fs/promises";
import { db, SupplierType, ProductStatus, Prisma } from "@chambelli/database";
import {
  CJConnector,
  parseCJPrice,
  topCategoryIndex,
  normalizeCategory,
  titleFitsSite,
  type CJItem,
  type SiteMap,
} from "@chambelli/cj";
import { syncCanada } from "./canada.js";
import { syncUk } from "./uk.js";
import { checkAmazonListings } from "./amazon.js";

const PAGE_SIZE = 100;
const MAX_PAGES = Number(process.env.CJ_SYNC_MAX_PAGES ?? 50);
// US-warehouse pass: only these products can go live on US site carousels. Help: docs/CJ-SITE-MAP.md
const US_MAX_PAGES = Number(process.env.CJ_SYNC_US_MAX_PAGES ?? 30);
export const US_TAG = "us";
let running = false;

// Which CJ categories feed which website. Help: docs/CJ-SITE-MAP.md
const SITE_MAP_URL = new URL("../../../config/cj-site-map.json", import.meta.url);
// Site links are drafts: products stay DRAFT (hidden from carousels) until approved.
const SITE_PLACEMENT = "article-footer";

async function loadSiteMap(): Promise<SiteMap | null> {
  try {
    return JSON.parse(await readFile(process.env.CJ_SITE_MAP_PATH ?? SITE_MAP_URL, "utf8"));
  } catch (e) {
    console.warn("CJ site map not loaded:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Make sure every mapped site has a Website row, then link up to productsPerSite (50)
 * products from its CJ categories that pass its title rules. Existing links are kept;
 * nothing is activated. Sites below minProductsPerSite (30) are logged.
 */
/**
 * Re-checks CJ US-warehouse stock for products live on website carousels, so a sold-out
 * product drops off the carousel by itself (and comes back when CJ restocks).
 */
async function refreshSiteStock(cj: CJConnector) {
  const variants = await db.productVariant.findMany({
    where: { sku: { endsWith: "-US" }, warehouse: "US", currency: "USD" },
    include: { product: { include: { supplierProducts: { take: 1 } } } },
  });
  let changed = 0;
  for (const v of variants) {
    const sp = v.product.supplierProducts[0];
    if (!sp || v.product.status === ProductStatus.DRAFT) continue;
    await new Promise((r) => setTimeout(r, 1100)); // CJ allows one request per second
    const stock = await cj.warehouseStock(sp.supplierProductId, "US").catch(() => null);
    if (stock === null || stock === v.quantity) continue;
    await db.productVariant.update({ where: { id: v.id }, data: { quantity: stock } });
    // Keep the product on UK carousels if it still has UK (GBP) stock.
    const otherStock =
      stock > 0
        ? 0
        : await db.productVariant.count({
            where: { productId: v.productId, currency: "GBP", active: true, quantity: { gt: 0 } },
          });
    await db.product.update({
      where: { id: v.productId },
      data: {
        status: stock > 0 || otherStock > 0 ? ProductStatus.ACTIVE : ProductStatus.OUT_OF_STOCK,
      },
    });
    changed++;
  }
  console.log(`Website carousel stock: ${variants.length} checked, ${changed} changed`);

  // UK sites: GBP variants follow CJ UK-warehouse stock. Only the variant changes, because the
  // product's status is shared with US sites; a zero-stock variant drops off UK carousels.
  const ukVariants = await db.productVariant.findMany({
    where: { sku: { endsWith: "-UK" }, warehouse: "GB", currency: "GBP" },
    include: { product: { include: { supplierProducts: { where: { country: "GB" }, take: 1 } } } },
  });
  let ukChanged = 0;
  for (const v of ukVariants) {
    const sp = v.product.supplierProducts[0];
    if (!sp || v.product.status === ProductStatus.DRAFT) continue;
    await new Promise((r) => setTimeout(r, 1100));
    const stock = await cj.warehouseStock(sp.supplierProductId, "GB").catch(() => null);
    if (stock === null || stock === v.quantity) continue;
    await db.productVariant.update({ where: { id: v.id }, data: { quantity: stock } });
    ukChanged++;
  }
  if (ukVariants.length)
    console.log(`UK carousel stock: ${ukVariants.length} checked, ${ukChanged} changed`);
}

async function linkSites(map: SiteMap) {
  for (const s of map.sites) {
    // UK sites sell CJ UK-warehouse stock in GBP (UK chapter, docs/UK.md); the rest US/USD.
    const uk = s.market === "UK";
    const market = uk ? "UK" : "US";
    const currency = uk ? "GBP" : "USD";
    const site = await db.website.upsert({
      where: { slug: s.slug },
      update: { market, currency },
      create: {
        name: s.name,
        slug: s.slug,
        domain: s.domain,
        category: s.cjCategories[0] ?? "general",
        market,
        currency,
      },
    });
    if (!uk) {
      // US sites: drop waiting links to products CJ has no US-warehouse stock for (they can
      // never go live). Live products, removed ones and your CJ "Added Products" are kept.
      const pruned = await db.productAssignment.deleteMany({
        where: {
          websiteId: site.id,
          placement: SITE_PLACEMENT,
          active: true,
          product: {
            status: { not: ProductStatus.ACTIVE },
            NOT: [{ tags: { has: US_TAG } }, { tags: { has: ADDED_TAG } }],
          },
        },
      });
      if (pruned.count)
        console.log(`${s.domain}: dropped ${pruned.count} products with no US stock`);
    }
    const have = await db.productAssignment.count({
      where: { websiteId: site.id, placement: SITE_PLACEMENT },
    });
    let room = map.productsPerSite - have;
    if (room <= 0) continue;
    if (!uk) {
      // Most relevant first: products found by searching this site's own terms in CJ's US
      // warehouse (tag "site:<slug>", see syncSiteTerms). Help: docs/CJ-SITE-MAP.md
      const termHits = await db.product.findMany({
        where: {
          supplierType: SupplierType.CJ,
          AND: [{ tags: { has: siteTag(s.slug) } }, { tags: { has: US_TAG } }],
          assignments: { none: { websiteId: site.id, placement: SITE_PLACEMENT } },
        },
        orderBy: { updatedAt: "desc" },
        take: room * 3,
        select: { id: true, title: true },
      });
      const picked = termHits
        .filter((p) => titleFitsSite(p.title, { titleExclude: s.titleExclude }))
        .slice(0, room);
      if (picked.length) {
        await db.productAssignment.createMany({
          data: picked.map((p) => ({
            productId: p.id,
            websiteId: site.id,
            placement: SITE_PLACEMENT,
          })),
          skipDuplicates: true,
        });
        console.log(`Linked ${picked.length} term-matched CJ products to ${s.domain} (drafts)`);
        room -= picked.length;
      }
      if (room <= 0) continue;
    }
    // Fetch extra so the titleMatch/titleExclude rules can still fill the room.
    const candidates = await db.product.findMany({
      where: {
        supplierType: SupplierType.CJ,
        // UK products come from the UK sync (tag "uk"), which does not set a CJ category.
        ...(uk
          ? { tags: { has: "uk" }, category: { in: [...s.cjCategories, "uncategorized"] } }
          : { category: { in: s.cjCategories }, tags: { has: US_TAG } }),
        assignments: { none: { websiteId: site.id, placement: SITE_PLACEMENT } },
      },
      orderBy: { updatedAt: "desc" },
      take: s.titleMatch?.length || s.titleExclude?.length ? room * 20 : room,
      select: { id: true, title: true },
    });
    const products = candidates.filter((p) => titleFitsSite(p.title, s)).slice(0, room);
    const min = map.minProductsPerSite ?? 0;
    if (have + products.length < min)
      console.warn(
        `${s.domain}: only ${have + products.length} products, below the minimum of ${min}`,
      );
    if (!products.length) continue;
    await db.productAssignment.createMany({
      data: products.map((p) => ({
        productId: p.id,
        websiteId: site.id,
        placement: SITE_PLACEMENT,
      })),
      skipDuplicates: true,
    });
    console.log(`Linked ${products.length} CJ products to ${s.domain} (drafts)`);
  }
}

/** Tag on products found by searching a site's own terms (most relevant for that site). */
const siteTag = (slug: string) => `site:${slug}`;
const TERM_PAGE_SIZE = 50;

/**
 * Most-relevant sourcing for US sites that are short of products: searches each of the site's
 * `terms` in CJ's US warehouse (in-stock only) and keeps results whose title matches the site
 * (its titleMatch words, or the search term itself) and avoids its titleExclude words. Those
 * products get the "us" and "site:<slug>" tags, and linkSites offers them to that site first.
 * One CJ request per term, about one per second. Help: docs/CJ-SITE-MAP.md
 */
async function syncSiteTerms(
  cj: CJConnector,
  supplierId: string,
  index: Map<string, string>,
  map: SiteMap,
  errors: Array<{ pid: string; message: string }>,
) {
  for (const s of map.sites) {
    if (s.market === "UK" || !s.terms?.length) continue;
    const site = await db.website.findUnique({ where: { slug: s.slug } });
    const have = site
      ? await db.productAssignment.count({
          where: { websiteId: site.id, placement: SITE_PLACEMENT, active: true },
        })
      : 0;
    const room = map.productsPerSite - have;
    if (room <= 0) continue;
    let found = 0;
    for (const term of s.terms) {
      if (found >= room * 2) break;
      await new Promise((r) => setTimeout(r, 1100)); // CJ allows about one request per second
      let items: CJItem[] = [];
      try {
        items = await cj.listProducts(1, TERM_PAGE_SIZE, {
          productNameEn: term,
          countryCode: "US",
          minInventory: 1,
        });
      } catch (e) {
        console.warn(
          `${s.domain}: CJ search "${term}" failed:`,
          e instanceof Error ? e.message : e,
        );
        continue;
      }
      for (const item of items) {
        const title = item.productNameEn ?? "";
        const relevant =
          titleFitsSite(title, s) ||
          (title.toLowerCase().includes(term.toLowerCase()) &&
            titleFitsSite(title, { titleExclude: s.titleExclude }));
        if (!relevant) continue;
        try {
          const product = await upsertItem(supplierId, item, categoryFor(item, index, map));
          const add = [US_TAG, siteTag(s.slug)].filter((t) => !product.tags.includes(t));
          if (add.length)
            await db.product.update({
              where: { id: product.id },
              data: { tags: { push: add } },
            });
          found++;
        } catch (e) {
          errors.push({ pid: item.pid, message: e instanceof Error ? e.message : "unknown" });
        }
      }
    }
    console.log(`${s.domain}: ${found} relevant US-stock products found from its search terms`);
  }
}

/** CJ top-level category name for an item, spelled as in the site map when it matches. */
function categoryFor(item: CJItem, index: Map<string, string>, map: SiteMap | null): string {
  const top = item.categoryId ? index.get(item.categoryId) : undefined;
  if (!top) return "uncategorized";
  const mapped = map?.sites
    .flatMap((s) => s.cjCategories)
    .find((c) => normalizeCategory(c) === normalizeCategory(top));
  return mapped ?? top;
}

async function upsertItem(supplierId: string, item: CJItem, category: string) {
  const sku = item.productSku ?? item.pid;
  const price = parseCJPrice(item.sellPrice ?? undefined);
  const raw = item as unknown as Prisma.InputJsonValue;
  const product = await db.product.upsert({
    where: { sku },
    create: {
      sku,
      slug: `cj-${item.pid}`,
      title: item.productNameEn ?? sku,
      imageUrl: item.productImage,
      category,
      tags: [],
      supplierType: SupplierType.CJ,
      status: ProductStatus.DRAFT,
    },
    update: { title: item.productNameEn ?? sku, imageUrl: item.productImage, category },
  });
  await db.supplierProduct.upsert({
    where: { supplierId_supplierProductId: { supplierId, supplierProductId: item.pid } },
    create: {
      supplierId,
      productId: product.id,
      supplierProductId: item.pid,
      supplierSku: sku,
      supplierPrice: price,
      raw,
      lastSyncAt: new Date(),
    },
    update: { supplierPrice: price, raw, lastSyncAt: new Date() },
  });
  return product;
}

// Tag on products Shaheen added himself in CJ (the dashboard's "Added Products" page).
export const ADDED_TAG = "cj-added";

/**
 * Pulls every product on the CJ "Added Products" page into Chambelli as a DRAFT tagged
 * cj-added, with its real CJ category so the site map can place it. Returns the count saved.
 */
async function syncAddedProducts(
  cj: CJConnector,
  supplierId: string,
  index: Map<string, string>,
  map: SiteMap | null,
  errors: Array<{ pid: string; message: string }>,
): Promise<number> {
  let saved = 0;
  for await (const page of cj.allMyProducts()) {
    for (const item of page) {
      try {
        await new Promise((r) => setTimeout(r, 1100)); // one CJ request per second
        const categoryId = await cj.categoryIdByPid(item.pid).catch(() => null);
        const full = categoryId ? { ...item, categoryId } : item;
        const product = await upsertItem(supplierId, full, categoryFor(full, index, map));
        if (!product.tags.includes(ADDED_TAG))
          await db.product.update({
            where: { id: product.id },
            data: { tags: { push: ADDED_TAG } },
          });
        saved++;
      } catch (e) {
        errors.push({ pid: item.pid, message: e instanceof Error ? e.message : "unknown" });
      }
    }
  }
  console.log(`CJ Added Products: ${saved} saved to Chambelli`);
  return saved;
}

export async function sync() {
  if (!process.env.CJ_ACCESS_TOKEN || !process.env.CJ_API_BASE_URL) {
    console.log("CJ sync skipped: credentials not configured");
    return;
  }
  if (running) {
    console.log("CJ sync skipped: previous run still in progress");
    return;
  }
  running = true;
  const supplier = await db.supplier.upsert({
    where: { slug: "cj" },
    update: { active: true },
    create: { name: "CJ Dropshipping", slug: "cj", type: SupplierType.CJ },
  });
  const job = await db.syncJob.create({
    data: { supplierId: supplier.id, type: "CJ_PRODUCTS", status: "RUNNING" },
  });
  let processed = 0;
  const errors: Array<{ pid: string; message: string }> = [];
  try {
    const cj = new CJConnector(process.env.CJ_ACCESS_TOKEN, process.env.CJ_API_BASE_URL);
    const map = await loadSiteMap();
    let index = new Map<string, string>();
    try {
      index = topCategoryIndex(await cj.getCategories());
    } catch (e) {
      console.warn("CJ categories not loaded:", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 1100)); // CJ allows about one request per second
    // Shaheen's hand-picked CJ "Added Products" come in first. Help: docs/CJ-SITE-MAP.md
    try {
      processed += await syncAddedProducts(cj, supplier.id, index, map, errors);
    } catch (e) {
      console.error("CJ Added Products sync failed", e);
    }
    await new Promise((r) => setTimeout(r, 1100));
    for await (const page of cj.allProducts(PAGE_SIZE, MAX_PAGES)) {
      for (const item of page) {
        try {
          await upsertItem(supplier.id, item, categoryFor(item, index, map));
          processed++;
        } catch (e) {
          errors.push({ pid: item.pid, message: e instanceof Error ? e.message : "unknown" });
        }
      }
    }
    // US-warehouse pass: products with CJ US stock get the "us" tag, which US carousels need.
    await new Promise((r) => setTimeout(r, 1100));
    let usSaved = 0;
    try {
      for await (const page of cj.allProducts(PAGE_SIZE, US_MAX_PAGES, 1100, {
        countryCode: "US",
        minInventory: 1,
      })) {
        for (const item of page) {
          try {
            const product = await upsertItem(supplier.id, item, categoryFor(item, index, map));
            if (!product.tags.includes(US_TAG))
              await db.product.update({
                where: { id: product.id },
                data: { tags: { push: US_TAG } },
              });
            usSaved++;
          } catch (e) {
            errors.push({ pid: item.pid, message: e instanceof Error ? e.message : "unknown" });
          }
        }
      }
    } catch (e) {
      console.error("CJ US-warehouse sync failed", e);
    }
    processed += usSaved;
    console.log(`CJ US warehouse: ${usSaved} products tagged "${US_TAG}"`);
    await db.syncJob.update({
      where: { id: job.id },
      data: {
        status: errors.length ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
        processed,
        failures: errors.length,
        details: errors.length ? { errors: errors.slice(0, 100) } : undefined,
        completedAt: new Date(),
      },
    });
    console.log(`CJ sync finished: ${processed} products, ${errors.length} failures`);
    if (map) {
      try {
        await syncSiteTerms(cj, supplier.id, index, map, errors);
      } catch (e) {
        console.error("CJ site-term sourcing failed", e);
      }
      try {
        await linkSites(map);
      } catch (e) {
        console.error("Linking CJ products to sites failed", e);
      }
      try {
        await refreshSiteStock(cj);
      } catch (e) {
        console.error("Refreshing website carousel stock failed", e);
      }
    }
    // Canada chapter: runs after the main sync, only when CJ_SYNC_CANADA=true.
    if (process.env.CJ_SYNC_CANADA === "true") await syncCanada(cj);
    // UK chapter: GB-warehouse stock priced in GBP, only when CJ_SYNC_UK=true. Help: docs/UK.md
    if (process.env.CJ_SYNC_UK === "true") await syncUk(cj);
  } catch (e) {
    await db.syncJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        processed,
        failures: errors.length + 1,
        details: { message: e instanceof Error ? e.message : "unknown" },
        completedAt: new Date(),
      },
    });
    console.error("CJ sync failed", e);
  } finally {
    running = false;
  }
}

cron.schedule("0 */6 * * *", () => void sync());
// Amazon US/CA/MX: re-check CJ stock and cost for live listings every 6 hours, after the sync.
cron.schedule("30 */6 * * *", () => void checkAmazonListings());
void sync();

const shutdown = () => void db.$disconnect().finally(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

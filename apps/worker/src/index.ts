import cron from "node-cron";
import { readFile } from "node:fs/promises";
import { db, SupplierType, ProductStatus, Prisma } from "@chambelli/database";
import {
  CJConnector,
  parseCJPrice,
  topCategoryIndex,
  normalizeCategory,
  type CJItem,
  type SiteMap,
} from "@chambelli/cj";

const PAGE_SIZE = 100;
const MAX_PAGES = Number(process.env.CJ_SYNC_MAX_PAGES ?? 50);
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
 * Make sure every mapped site has a Website row, then link up to productsPerSite
 * products from its CJ categories. Existing links are kept; nothing is activated.
 */
async function linkSites(map: SiteMap) {
  for (const s of map.sites) {
    const site = await db.website.upsert({
      where: { slug: s.slug },
      update: {},
      create: {
        name: s.name,
        slug: s.slug,
        domain: s.domain,
        category: s.cjCategories[0] ?? "general",
        market: "US",
      },
    });
    const have = await db.productAssignment.count({
      where: { websiteId: site.id, placement: SITE_PLACEMENT },
    });
    const room = map.productsPerSite - have;
    if (room <= 0) continue;
    const products = await db.product.findMany({
      where: {
        supplierType: SupplierType.CJ,
        category: { in: s.cjCategories },
        assignments: { none: { websiteId: site.id, placement: SITE_PLACEMENT } },
      },
      orderBy: { updatedAt: "desc" },
      take: room,
      select: { id: true },
    });
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
  const price = parseCJPrice(item.sellPrice);
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
        await linkSites(map);
      } catch (e) {
        console.error("Linking CJ products to sites failed", e);
      }
    }
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
void sync();

const shutdown = () => void db.$disconnect().finally(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

import cron from "node-cron";
import { db, SupplierType, ProductStatus, Prisma } from "@chambelli/database";
import { CJConnector, parseCJPrice, type CJItem } from "@chambelli/cj";

const PAGE_SIZE = 100;
const MAX_PAGES = Number(process.env.CJ_SYNC_MAX_PAGES ?? 50);
let running = false;

async function upsertItem(supplierId: string, item: CJItem) {
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
      category: "uncategorized",
      tags: [],
      supplierType: SupplierType.CJ,
      status: ProductStatus.DRAFT,
    },
    update: { title: item.productNameEn ?? sku, imageUrl: item.productImage },
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
    for await (const page of cj.allProducts(PAGE_SIZE, MAX_PAGES)) {
      for (const item of page) {
        try {
          await upsertItem(supplier.id, item);
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

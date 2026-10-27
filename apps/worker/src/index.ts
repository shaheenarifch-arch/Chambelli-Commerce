import cron from "node-cron";
import { db, SupplierType, ProductStatus } from "@chambelli/database";
import { CJConnector } from "@chambelli/cj";
async function sync() {
  if (!process.env.CJ_ACCESS_TOKEN || !process.env.CJ_API_BASE_URL) {
    console.log("CJ sync skipped: credentials not configured");
    return;
  }
  const supplier = await db.supplier.upsert({
    where: { slug: "cj" },
    update: { active: true },
    create: { name: "CJ Dropshipping", slug: "cj", type: SupplierType.CJ },
  });
  const job = await db.syncJob.create({
    data: { supplierId: supplier.id, type: "CJ_PRODUCTS", status: "RUNNING" },
  });
  try {
    const items = await new CJConnector(
      process.env.CJ_ACCESS_TOKEN,
      process.env.CJ_API_BASE_URL,
    ).listProducts();
    let processed = 0;
    for (const item of items) {
      const sku = item.productSku ?? item.pid;
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
        where: {
          supplierId_supplierProductId: { supplierId: supplier.id, supplierProductId: item.pid },
        },
        create: {
          supplierId: supplier.id,
          productId: product.id,
          supplierProductId: item.pid,
          supplierSku: sku,
          supplierPrice: Number(item.sellPrice ?? 0),
          raw: item,
        },
        update: { supplierPrice: Number(item.sellPrice ?? 0), raw: item, lastSyncAt: new Date() },
      });
      processed++;
    }
    await db.syncJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", processed, completedAt: new Date() },
    });
  } catch (e) {
    await db.syncJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        failures: 1,
        details: { message: e instanceof Error ? e.message : "unknown" },
        completedAt: new Date(),
      },
    });
    throw e;
  }
}
cron.schedule("0 */6 * * *", () => void sync());
void sync();

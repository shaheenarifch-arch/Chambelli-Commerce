import { db, SupplierType, ProductStatus, Prisma } from "@chambelli/database";
import { CJConnector, parseCJPrice, type CJItem } from "@chambelli/cj";
import { dePrice, DE_MIN_MARGIN_PERCENT, ending99, holdPriceChange } from "@chambelli/pricing";
import { InventoryService } from "@chambelli/inventory";

/**
 * Germany chapter sync: only CJ products with stock in German (DE) warehouses.
 * Each one gets a EUR variant ("<sku>-DE") priced for a 30% margin with German delivery built in,
 * plus VAT when DE_VAT_PERCENT is set (leave 0 until you are registered for EU VAT).
 * New products stay DRAFT until you approve them, exactly like the US and Canada catalogs.
 * Help: docs/DE.md
 */
const COUNTRY = "DE";
const MAX_PAGES = Number(process.env.CJ_SYNC_DE_MAX_PAGES ?? 20);
const DELAY_MS = 1100; // CJ allows one request per second
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function syncDe(cj: CJConnector) {
  const rate = Number(process.env.USD_TO_EUR_RATE);
  const shipping = Number(process.env.DE_SHIPPING_ESTIMATE_EUR);
  if (!(rate > 0) || !(shipping >= 0) || !process.env.DE_SHIPPING_ESTIMATE_EUR) {
    console.log(
      "Germany sync skipped: set USD_TO_EUR_RATE and DE_SHIPPING_ESTIMATE_EUR (see .env.example)",
    );
    return;
  }
  const margin = Number(process.env.DE_MIN_MARGIN_PERCENT ?? DE_MIN_MARGIN_PERCENT);
  const vat = Number(process.env.DE_VAT_PERCENT ?? 0);

  // A separate supplier record keeps German stock apart from the US/China sync of the same item.
  const supplier = await db.supplier.upsert({
    where: { slug: "cj-de" },
    update: { active: true },
    create: { name: "CJ Dropshipping (Germany warehouses)", slug: "cj-de", type: SupplierType.CJ },
  });
  const job = await db.syncJob.create({
    data: { supplierId: supplier.id, type: "CJ_PRODUCTS_DE", status: "RUNNING" },
  });
  const inventory = new InventoryService();
  let processed = 0;
  let skipped = 0;
  const errors: Array<{ pid: string; message: string }> = [];

  const upsert = async (item: CJItem) => {
    const priceUsd = parseCJPrice(item.sellPrice ?? undefined);
    const priced = dePrice(priceUsd, shipping, rate, margin, vat);
    if (!priced) return false;
    await sleep(DELAY_MS);
    const stock = await cj.warehouseStock(item.pid, COUNTRY);

    const sku = item.productSku ?? item.pid;
    const product = await db.product.upsert({
      where: { sku },
      create: {
        sku,
        slug: `cj-${item.pid}`,
        title: item.productNameEn ?? sku,
        imageUrl: item.productImage,
        category: "uncategorized",
        tags: ["de"],
        supplierType: SupplierType.CJ,
        status: ProductStatus.DRAFT,
      },
      update: { title: item.productNameEn ?? sku, imageUrl: item.productImage },
    });
    if (!product.tags.includes("de")) {
      await db.product.update({ where: { id: product.id }, data: { tags: { push: "de" } } });
    }
    await db.supplierProduct.upsert({
      where: {
        supplierId_supplierProductId: { supplierId: supplier.id, supplierProductId: item.pid },
      },
      create: {
        supplierId: supplier.id,
        productId: product.id,
        supplierProductId: item.pid,
        supplierSku: `${sku}-DE`,
        supplierPrice: priceUsd,
        supplierStock: stock,
        warehouse: COUNTRY,
        country: COUNTRY,
        raw: item as unknown as Prisma.InputJsonValue,
        lastSyncAt: new Date(),
      },
      update: { supplierPrice: priceUsd, supplierStock: stock, lastSyncAt: new Date() },
    });
    const price = ending99(priced.price);
    const values = {
      cost: priced.cost,
      shippingCost: priced.shipping,
      currency: "EUR",
      warehouse: COUNTRY,
    };
    // Price hold: a sync never changes a price shoppers already see. A new price waits on the
    // hub's Carousels page until you accept it.
    const existing = await db.productVariant.findUnique({ where: { sku: `${sku}-DE` } });
    const hold = existing
      ? holdPriceChange(
          Number(existing.price),
          price,
          existing.declinedPrice === null ? null : Number(existing.declinedPrice),
        )
      : null;
    const variant = await db.productVariant.upsert({
      where: { sku: `${sku}-DE` },
      create: {
        ...values,
        price,
        productId: product.id,
        sku: `${sku}-DE`,
        name: "Ships from Germany",
      },
      update: {
        ...values,
        pendingPrice: hold?.pendingPrice ?? null,
        pendingPriceAt:
          hold?.pendingPrice == null
            ? null
            : existing?.pendingPrice != null &&
                Math.abs(Number(existing.pendingPrice) - hold.pendingPrice) < 0.005
              ? existing.pendingPriceAt
              : new Date(),
      },
    });
    // Applies the safety buffer and records a snapshot; zero stock hides it from the storefront.
    await inventory.update(variant.id, stock, "cj-de");
    return true;
  };

  try {
    for await (const page of cj.allProducts(100, MAX_PAGES, DELAY_MS, {
      countryCode: COUNTRY,
      minInventory: 1,
    })) {
      for (const item of page) {
        try {
          if (await upsert(item)) processed++;
          else skipped++;
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
        details: { skippedNoPrice: skipped, errors: errors.slice(0, 100) },
        completedAt: new Date(),
      },
    });
    console.log(
      `Germany sync finished: ${processed} products, ${skipped} skipped, ${errors.length} failures`,
    );
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
    console.error("Germany sync failed", e);
  }
}

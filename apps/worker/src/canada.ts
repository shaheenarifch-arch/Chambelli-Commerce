import { db, SupplierType, ProductStatus, Prisma } from "@chambelli/database";
import { CJConnector, parseCJPrice, type CJItem } from "@chambelli/cj";
import { canadaPrice, CANADA_MIN_MARGIN_PERCENT } from "@chambelli/pricing";
import { InventoryService } from "@chambelli/inventory";

/**
 * Canada chapter sync: only CJ products with stock in Canadian warehouses.
 * Each one gets a CAD variant ("<sku>-CA") priced for a 30% margin with shipping built in.
 * New products stay DRAFT until you approve them, exactly like the US catalog.
 */
const COUNTRY = "CA";
const MAX_PAGES = Number(process.env.CJ_SYNC_CANADA_MAX_PAGES ?? 20);
const DELAY_MS = 1100; // CJ allows one request per second
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function syncCanada(cj: CJConnector) {
  const rate = Number(process.env.USD_TO_CAD_RATE);
  const shipping = Number(process.env.CA_SHIPPING_ESTIMATE_CAD);
  if (!(rate > 0) || !(shipping >= 0) || process.env.CA_SHIPPING_ESTIMATE_CAD === undefined) {
    console.log(
      "Canada sync skipped: set USD_TO_CAD_RATE and CA_SHIPPING_ESTIMATE_CAD (see .env.example)",
    );
    return;
  }
  const margin = Number(process.env.CA_MIN_MARGIN_PERCENT ?? CANADA_MIN_MARGIN_PERCENT);

  // A separate supplier record keeps Canadian stock apart from the US/China sync of the same item.
  const supplier = await db.supplier.upsert({
    where: { slug: "cj-ca" },
    update: { active: true },
    create: { name: "CJ Dropshipping (Canada warehouses)", slug: "cj-ca", type: SupplierType.CJ },
  });
  const job = await db.syncJob.create({
    data: { supplierId: supplier.id, type: "CJ_PRODUCTS_CA", status: "RUNNING" },
  });
  const inventory = new InventoryService();
  let processed = 0;
  let skipped = 0;
  const errors: Array<{ pid: string; message: string }> = [];

  const upsert = async (item: CJItem) => {
    const priceUsd = parseCJPrice(item.sellPrice);
    const priced = canadaPrice(priceUsd, shipping, rate, margin);
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
        tags: ["canada"],
        supplierType: SupplierType.CJ,
        status: ProductStatus.DRAFT,
      },
      update: { title: item.productNameEn ?? sku, imageUrl: item.productImage },
    });
    if (!product.tags.includes("canada")) {
      await db.product.update({ where: { id: product.id }, data: { tags: { push: "canada" } } });
    }
    await db.supplierProduct.upsert({
      where: {
        supplierId_supplierProductId: { supplierId: supplier.id, supplierProductId: item.pid },
      },
      create: {
        supplierId: supplier.id,
        productId: product.id,
        supplierProductId: item.pid,
        supplierSku: `${sku}-CA`,
        supplierPrice: priceUsd,
        supplierStock: stock,
        warehouse: COUNTRY,
        country: COUNTRY,
        raw: item as unknown as Prisma.InputJsonValue,
        lastSyncAt: new Date(),
      },
      update: { supplierPrice: priceUsd, supplierStock: stock, lastSyncAt: new Date() },
    });
    const values = {
      cost: priced.cost,
      shippingCost: priced.shipping,
      price: priced.price,
      currency: "CAD",
      warehouse: COUNTRY,
    };
    const variant = await db.productVariant.upsert({
      where: { sku: `${sku}-CA` },
      create: { ...values, productId: product.id, sku: `${sku}-CA`, name: "Ships from Canada" },
      update: values,
    });
    // Applies the safety buffer and records a snapshot; zero stock hides it from the storefront.
    await inventory.update(variant.id, stock, "cj-ca");
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
      `Canada sync finished: ${processed} products, ${skipped} skipped, ${errors.length} failures`,
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
    console.error("Canada sync failed", e);
  }
}

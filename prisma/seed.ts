import { PrismaClient, SupplierType, ProductStatus } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const site = await db.website.upsert({
    where: { slug: "tech" },
    update: {},
    create: {
      name: "Tech Site",
      slug: "tech",
      domain: "tech.example.com",
      category: "technology",
      market: "US",
    },
  });
  const supplier = await db.supplier.upsert({
    where: { slug: "owned" },
    update: {},
    create: { name: "Owned Inventory", slug: "owned", type: SupplierType.OWNED },
  });
  for (let i = 1; i <= 6; i++) {
    const p = await db.product.upsert({
      where: { sku: `DEMO-${i}` },
      update: {},
      create: {
        sku: `DEMO-${i}`,
        slug: `demo-product-${i}`,
        title: `Demo Product ${i}`,
        category: "technology",
        tags: ["demo"],
        supplierType: SupplierType.OWNED,
        status: ProductStatus.ACTIVE,
        imageUrl: `https://picsum.photos/seed/${i}/600/600`,
        variants: {
          create: { sku: `DEMO-${i}-STD`, name: "Standard", cost: 10, price: 19.99, quantity: 100 },
        },
      },
    });
    await db.productAssignment.upsert({
      where: {
        productId_websiteId_placement: {
          productId: p.id,
          websiteId: site.id,
          placement: "article-footer",
        },
      },
      update: {},
      create: {
        productId: p.id,
        websiteId: site.id,
        placement: "article-footer",
        priority: 100 - i,
      },
    });
  }
  await db.carouselPlacement.upsert({
    where: { websiteId_key: { websiteId: site.id, key: "article-footer" } },
    update: {},
    create: { websiteId: site.id, key: "article-footer" },
  });
}
main().finally(() => db.$disconnect());

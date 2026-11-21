/**
 * Germany chapter setup. Safe to run again at any time: `pnpm db:de` (guide: docs/DE.md)
 *
 * 1. Creates the Chambelli Germany site (market DE, prices in EUR) for agent.getservices.ai/de.
 * 2. Creates its "storefront" carousel (30 products).
 * 3. Puts approved (ACTIVE) German-warehouse products with EUR stock on it, up to 30.
 *    Products stay off the storefront until you approve them in the hub.
 */
import { PrismaClient, ProductStatus } from "@prisma/client";

const db = new PrismaClient();
const PLACEMENT = "storefront";
const MAX = 30;

async function main() {
  const site = await db.website.upsert({
    where: { slug: "chambelli-de" },
    update: { market: "DE", currency: "EUR", active: true },
    create: {
      name: "Chambelli Germany",
      slug: "chambelli-de",
      domain: "agent.getservices.ai/de",
      category: "general",
      market: "DE",
      currency: "EUR",
    },
  });
  await db.carouselPlacement.upsert({
    where: { websiteId_key: { websiteId: site.id, key: PLACEMENT } },
    update: {},
    create: { websiteId: site.id, key: PLACEMENT, title: "Ships from Germany", limit: MAX },
  });

  const products = await db.product.findMany({
    where: {
      status: ProductStatus.ACTIVE,
      variants: { some: { currency: "EUR", active: true, quantity: { gt: 0 } } },
    },
    include: { score: true },
    orderBy: { updatedAt: "desc" },
    take: MAX,
  });
  for (const [i, p] of products.entries()) {
    await db.productAssignment.upsert({
      where: {
        productId_websiteId_placement: {
          productId: p.id,
          websiteId: site.id,
          placement: PLACEMENT,
        },
      },
      update: { active: true },
      create: { productId: p.id, websiteId: site.id, placement: PLACEMENT, priority: 100 - i },
    });
  }
  console.log(
    `Chambelli Germany ready: site ${site.id}, ${products.length} products on the storefront`,
  );
}

main().finally(() => db.$disconnect());

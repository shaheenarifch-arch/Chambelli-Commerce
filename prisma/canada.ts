/**
 * Canada chapter setup. Safe to run again at any time: `pnpm db:canada`
 *
 * 1. Creates the Chambelli Canada site (market CA, prices in CAD) for agent.getservices.ai/ca.
 * 2. Creates its "storefront" carousel (30 products).
 * 3. Puts approved (ACTIVE) Canadian-warehouse products with CAD stock on it, up to 30.
 *    Products stay off the storefront until you approve them in the hub.
 */
import { PrismaClient, ProductStatus } from "@prisma/client";

const db = new PrismaClient();
const PLACEMENT = "storefront";
const MAX = 30;

async function main() {
  const site = await db.website.upsert({
    where: { slug: "chambelli-ca" },
    update: { market: "CA", currency: "CAD", active: true },
    create: {
      name: "Chambelli Canada",
      slug: "chambelli-ca",
      domain: "agent.getservices.ai/ca",
      category: "general",
      market: "CA",
      currency: "CAD",
    },
  });
  await db.carouselPlacement.upsert({
    where: { websiteId_key: { websiteId: site.id, key: PLACEMENT } },
    update: {},
    create: { websiteId: site.id, key: PLACEMENT, title: "Ships from Canada", limit: MAX },
  });

  const products = await db.product.findMany({
    where: {
      status: ProductStatus.ACTIVE,
      variants: { some: { currency: "CAD", active: true, quantity: { gt: 0 } } },
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
    `Chambelli Canada ready: site ${site.id}, ${products.length} products on the storefront`,
  );
}

main().finally(() => db.$disconnect());

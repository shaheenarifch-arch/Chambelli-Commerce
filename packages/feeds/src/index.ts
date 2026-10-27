import { Redis } from "ioredis";
import { db, ProductStatus } from "@chambelli/database";
const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { lazyConnect: true })
  : null;
export class FeedService {
  async get(siteSlug: string, placement = "article-footer", limit = 30) {
    const key = `feed:${siteSlug}:${placement}:${limit}`;
    if (redis) {
      const c = await redis.get(key);
      if (c) return JSON.parse(c);
    }
    const site = await db.website.findUnique({ where: { slug: siteSlug } });
    if (!site) return null;
    const rows = await db.productAssignment.findMany({
      where: {
        websiteId: site.id,
        placement,
        active: true,
        product: {
          status: ProductStatus.ACTIVE,
          variants: { some: { active: true, quantity: { gt: 0 } } },
        },
      },
      include: {
        product: {
          include: {
            variants: { where: { active: true, quantity: { gt: 0 } }, take: 1 },
            score: true,
          },
        },
      },
      orderBy: [{ priority: "desc" }],
      take: Math.min(limit, 30),
    });
    const products = rows.map((r, index) => ({
      id: r.product.id,
      slug: r.product.slug,
      title: r.product.title,
      imageUrl: r.product.imageUrl,
      category: r.product.category,
      price: Number(r.product.variants[0]?.price ?? 0),
      compareAtPrice: r.product.variants[0]?.compareAtPrice
        ? Number(r.product.variants[0].compareAtPrice)
        : null,
      currency: r.product.variants[0]?.currency ?? site.currency,
      position: index + 1,
    }));
    const out = {
      site: { id: site.id, slug: site.slug, market: site.market },
      placement,
      products,
    };
    if (redis) await redis.set(key, JSON.stringify(out), "EX", 600);
    return out;
  }
  async invalidate(siteSlug: string) {
    if (!redis) return;
    const keys = await redis.keys(`feed:${siteSlug}:*`);
    if (keys.length) await redis.del(...keys);
  }
}

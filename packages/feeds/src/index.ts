import { Redis } from "ioredis";
import { db, ProductStatus } from "@chambelli/database";

const MAX_PRODUCTS = 30;
const CACHE_SECONDS = 600;

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  : null;
redis?.on("error", () => {
  // Cache is optional: errors are handled per call and the feed falls back to the database.
});

async function cacheGet(key: string): Promise<string | null> {
  if (!redis) return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: string) {
  if (!redis) return;
  try {
    await redis.set(key, value, "EX", CACHE_SECONDS);
  } catch {
    // ignore: a cache miss next time is harmless
  }
}

export interface FeedProduct {
  id: string;
  variantId: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  category: string;
  price: number;
  compareAtPrice: number | null;
  currency: string;
  position: number;
}

export interface Feed {
  site: { id: string; slug: string; market: string };
  placement: string;
  products: FeedProduct[];
}

export class FeedService {
  async get(
    siteSlug: string,
    placement = "article-footer",
    limit = MAX_PRODUCTS,
  ): Promise<Feed | null> {
    const take = Math.max(1, Math.min(limit, MAX_PRODUCTS));
    const key = `feed:${siteSlug}:${placement}:${take}`;
    const cached = await cacheGet(key);
    if (cached) return JSON.parse(cached) as Feed;

    const site = await db.website.findUnique({ where: { slug: siteSlug } });
    if (!site || !site.active) return null;
    const now = new Date();
    const rows = await db.productAssignment.findMany({
      where: {
        websiteId: site.id,
        placement,
        active: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
        product: {
          status: ProductStatus.ACTIVE,
          variants: { some: { active: true, quantity: { gt: 0 } } },
        },
      },
      include: {
        product: {
          include: {
            variants: {
              where: { active: true, quantity: { gt: 0 } },
              orderBy: { price: "asc" },
              take: 1,
            },
          },
        },
      },
      // Manual priority first, then the learned performance score.
      orderBy: [{ priority: "desc" }, { product: { score: { finalScore: "desc" } } }],
      take,
    });
    const products: FeedProduct[] = rows.flatMap((r) => {
      const v = r.product.variants[0];
      if (!v) return [];
      return [
        {
          id: r.product.id,
          variantId: v.id,
          slug: r.product.slug,
          title: r.product.title,
          imageUrl: r.product.imageUrl,
          category: r.product.category,
          price: Number(v.price),
          compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : null,
          currency: v.currency ?? site.currency,
          position: 0,
        },
      ];
    });
    products.forEach((p, i) => (p.position = i + 1));
    const out: Feed = {
      site: { id: site.id, slug: site.slug, market: site.market },
      placement,
      products,
    };
    await cacheSet(key, JSON.stringify(out));
    return out;
  }

  /** Drop cached feeds for a site. Uses SCAN, which does not block Redis like KEYS does. */
  async invalidate(siteSlug: string) {
    if (!redis) return;
    try {
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `feed:${siteSlug}:*`, "COUNT", 100);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== "0");
    } catch {
      // cache entries expire on their own
    }
  }
}

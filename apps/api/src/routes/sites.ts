import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, ProductStatus } from "@chambelli/database";
import { CJConnector } from "@chambelli/cj";
import { computePrice, ukPrice } from "@chambelli/pricing";
import { requireAdmin } from "../auth.js";
import { config } from "../config.js";

/**
 * Website carousels (admin only): see each site's products and approve them in bulk.
 * Approving prices a product at the 30% margin floor with US shipping included, sets its
 * stock from CJ's US warehouse, and makes it ACTIVE so the site's carousel shows it.
 * UK sites (market "UK", docs/UK.md) are priced in GBP from CJ's UK warehouse instead.
 */
const PLACEMENT = "article-footer";
const MARGIN_PERCENT = 30;
const CJ_DELAY_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Rounds up to a .99 ending. */
const ending99 = (p: number) => {
  const c = Math.floor(p) + 0.99;
  return Number((c + 1e-9 >= p ? c : Math.floor(p) + 1.99).toFixed(2));
};

export async function siteRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin(config.adminApiKey));
  const approving = new Set<string>();

  /** Each site with how many products are live, waiting, and removed. */
  app.get("/v1/admin/sites", async () => {
    const sites = await db.website.findMany({ orderBy: { name: "asc" } });
    const rows = await db.productAssignment.findMany({
      where: { placement: PLACEMENT },
      select: {
        websiteId: true,
        active: true,
        product: {
          select: {
            status: true,
            variants: {
              where: { currency: "GBP", active: true, quantity: { gt: 0 } },
              select: { id: true },
            },
          },
        },
      },
    });
    return sites.map((s) => {
      const mine = rows.filter((r) => r.websiteId === s.id);
      // A UK product is live only once it has an in-stock GBP price (set by approval).
      const isLive = (r: (typeof mine)[number]) =>
        r.active &&
        r.product.status === ProductStatus.ACTIVE &&
        (s.market !== "UK" || r.product.variants.length > 0);
      return {
        ...s,
        live: mine.filter(isLive).length,
        waiting: mine.filter((r) => r.active && !isLive(r)).length,
        removed: mine.filter((r) => !r.active).length,
        approving: approving.has(s.id),
      };
    });
  });

  app.get("/v1/admin/sites/:slug/products", async (req) => {
    const { slug } = z.object({ slug: z.string().max(80) }).parse(req.params);
    const site = await db.website.findUniqueOrThrow({ where: { slug } });
    const rows = await db.productAssignment.findMany({
      where: { websiteId: site.id, placement: PLACEMENT },
      include: {
        product: {
          include: {
            variants: { where: { currency: site.currency } },
            supplierProducts: { select: { supplierPrice: true, supplierProductId: true } },
          },
        },
      },
      orderBy: [{ active: "desc" }, { priority: "desc" }],
    });
    return { site, rows };
  });

  /**
   * Approve products for a site (all waiting ones, or the ids given). Runs in the
   * background because CJ allows one stock lookup per second.
   */
  app.post("/v1/admin/sites/:slug/approve", async (req, reply) => {
    const { slug } = z.object({ slug: z.string().max(80) }).parse(req.params);
    const body = z
      .object({ productIds: z.array(z.string().uuid()).max(50).optional() })
      .parse(req.body ?? {});
    if (!config.cj.accessToken || !config.cj.baseUrl) throw new Error("CJ_NOT_CONFIGURED");
    const site = await db.website.findUniqueOrThrow({ where: { slug } });
    const uk = site.market === "UK";
    const shipping = config.sites.usShippingCost;
    if (!uk && shipping === null) throw new Error("SITE_SHIPPING_COST_NOT_SET");
    if (uk && (config.uk.usdToGbpRate === null || config.uk.shippingGbp === null))
      throw new Error("UK_PRICING_NOT_SET");
    if (approving.has(site.id)) return reply.code(202).send({ started: false, running: true });

    const rows = await db.productAssignment.findMany({
      where: {
        websiteId: site.id,
        placement: PLACEMENT,
        active: true,
        // UK: waiting until it has an in-stock GBP price, whatever its US status.
        product: uk
          ? { variants: { none: { currency: "GBP", active: true, quantity: { gt: 0 } } } }
          : { status: { not: ProductStatus.ACTIVE } },
        ...(body.productIds ? { productId: { in: body.productIds } } : {}),
      },
      include: { product: { include: { supplierProducts: true } } },
      take: 50,
    });
    const cj = new CJConnector(config.cj.accessToken, config.cj.baseUrl);
    approving.add(site.id);
    if (uk) {
      void approveUk(cj, rows, req.log).finally(() => approving.delete(site.id));
      return reply.code(202).send({ started: true, count: rows.length });
    }
    void (async () => {
      for (const [i, r] of rows.entries()) {
        try {
          const sp = r.product.supplierProducts[0];
          const cost = sp ? Number(sp.supplierPrice) : 0;
          if (!sp || !(cost > 0)) continue;
          if (i > 0) await sleep(CJ_DELAY_MS);
          const stock = await cj.warehouseStock(sp.supplierProductId, "US");
          const price = ending99(computePrice(cost, shipping, 0, MARGIN_PERCENT));
          const sku = `${r.product.sku}-US`;
          await db.productVariant.upsert({
            where: { sku },
            create: {
              productId: r.productId,
              sku,
              name: "Ships from US",
              cost,
              shippingCost: shipping,
              price,
              currency: "USD",
              warehouse: "US",
              quantity: stock,
            },
            update: { cost, shippingCost: shipping, price, quantity: stock, active: true },
          });
          await db.product.update({
            where: { id: r.productId },
            data: { status: stock > 0 ? ProductStatus.ACTIVE : ProductStatus.OUT_OF_STOCK },
          });
        } catch (e) {
          req.log.warn({ err: e, productId: r.productId }, "site approval failed for product");
        }
      }
    })().finally(() => approving.delete(site.id));
    return reply.code(202).send({ started: true, count: rows.length });
  });

  /** Take products off a site's carousel (or put them back). */
  app.post("/v1/admin/sites/:slug/assignments", async (req) => {
    const { slug } = z.object({ slug: z.string().max(80) }).parse(req.params);
    const b = z
      .object({ productIds: z.array(z.string().uuid()).min(1).max(50), active: z.boolean() })
      .parse(req.body);
    const site = await db.website.findUniqueOrThrow({ where: { slug } });
    const r = await db.productAssignment.updateMany({
      where: { websiteId: site.id, placement: PLACEMENT, productId: { in: b.productIds } },
      data: { active: b.active },
    });
    return { updated: r.count };
  });
}

type ApprovalRow = {
  productId: string;
  product: {
    sku: string;
    status: ProductStatus;
    supplierProducts: Array<{
      supplierProductId: string;
      supplierPrice: unknown;
      country: string | null;
    }>;
  };
};

/**
 * UK approval: GBP price from the CJ UK-warehouse cost (30% margin + UK shipping + VAT if set),
 * stock from CJ's UK warehouse. Only the GBP variant goes live; the product's US status is left
 * alone unless it was still a draft. Products with no UK stock stay waiting.
 */
async function approveUk(
  cj: CJConnector,
  rows: ApprovalRow[],
  log: { warn: (o: object, m: string) => void },
) {
  const { usdToGbpRate, shippingGbp, minMarginPercent, vatPercent } = config.uk;
  for (const [i, r] of rows.entries()) {
    try {
      const sp =
        r.product.supplierProducts.find((p) => p.country === "GB") ?? r.product.supplierProducts[0];
      const costUsd = sp ? Number(sp.supplierPrice) : 0;
      const priced = ukPrice(costUsd, shippingGbp!, usdToGbpRate!, minMarginPercent, vatPercent);
      if (!sp || !priced) continue;
      if (i > 0) await sleep(CJ_DELAY_MS);
      const stock = await cj.warehouseStock(sp.supplierProductId, "GB");
      const price = ending99(priced.price);
      const sku = `${r.product.sku}-UK`;
      await db.productVariant.upsert({
        where: { sku },
        create: {
          productId: r.productId,
          sku,
          name: "Ships from the UK",
          cost: priced.cost,
          shippingCost: priced.shipping,
          price,
          currency: "GBP",
          warehouse: "GB",
          quantity: stock,
        },
        update: {
          cost: priced.cost,
          shippingCost: priced.shipping,
          price,
          quantity: stock,
          active: true,
        },
      });
      if (stock > 0 && r.product.status !== ProductStatus.ACTIVE)
        await db.product.update({
          where: { id: r.productId },
          data: { status: ProductStatus.ACTIVE },
        });
    } catch (e) {
      log.warn({ err: e, productId: r.productId }, "UK site approval failed for product");
    }
  }
}

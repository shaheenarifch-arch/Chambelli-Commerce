import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, AmazonListingState, AmazonOrderStatus } from "@chambelli/database";
import { CJConnector } from "@chambelli/cj";
import { AmazonService, isMarketplace, settingsFromEnv, type Marketplace } from "@chambelli/amazon";
import { requireAdmin } from "../auth.js";
import { config } from "../config.js";

/**
 * Chambelli's control of Love$Care on Amazon US, Canada and Mexico (admin only).
 * Until Amazon approves SP-API access, changes reach Amazon as upload files you
 * review and upload in Seller Central; orders come in from the Unshipped Orders report.
 */
const REPORT_LIMIT = 10 * 1024 * 1024;

const Market = z.object({ marketplace: z.string().refine(isMarketplace, "INVALID_MARKETPLACE") });
const Id = z.object({ id: z.string().uuid() });

function cjClient() {
  if (!config.cj.accessToken || !config.cj.baseUrl) throw new Error("CJ_NOT_CONFIGURED");
  return new CJConnector(config.cj.accessToken, config.cj.baseUrl);
}
const settings = (m: Marketplace) => settingsFromEnv(process.env, m);

export async function amazonRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin(config.adminApiKey));
  const amazon = new AmazonService();
  /** Checks running in the background, one per marketplace. */
  const running = new Set<Marketplace>();

  app.get("/v1/admin/amazon/overview", async () => {
    const data = await amazon.overview();
    return {
      ...data,
      settings: (["US", "CA", "MX"] as const).map((m) => {
        const s = settings(m);
        return {
          marketplace: m,
          currency: s.currency,
          stockCountry: s.stockCountry,
          marginPercent: s.marginPercent,
          priceChecks: s.usdRate !== null && s.shippingCost !== null,
          cjOrdering: s.cjLogistic !== null,
          checking: running.has(m),
        };
      }),
      cjConfigured: Boolean(config.cj.accessToken && config.cj.baseUrl),
    };
  });

  app.get("/v1/admin/amazon/:marketplace/listings", async (req) => {
    const { marketplace } = Market.parse(req.params);
    const q = z
      .object({
        state: z.nativeEnum(AmazonListingState).optional(),
        alertsOnly: z.enum(["true", "false"]).optional(),
        search: z.string().max(100).optional(),
      })
      .parse(req.query);
    return db.amazonListing.findMany({
      where: {
        marketplace,
        ...(q.state ? { state: q.state } : {}),
        ...(q.alertsOnly === "true" ? { NOT: { alerts: { isEmpty: true } } } : {}),
        ...(q.search
          ? {
              OR: [
                { title: { contains: q.search, mode: "insensitive" } },
                { sellerSku: { contains: q.search, mode: "insensitive" } },
                { asin: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ state: "asc" }, { updatedAt: "desc" }],
      take: 500,
    });
  });

  app.post(
    "/v1/admin/amazon/:marketplace/listings/import",
    { bodyLimit: REPORT_LIMIT },
    async (req) => {
      const { marketplace } = Market.parse(req.params);
      const { text } = z.object({ text: z.string().min(10).max(REPORT_LIMIT) }).parse(req.body);
      return amazon.importListings(marketplace, text);
    },
  );

  /** Starts a CJ stock and cost check in the background; the page shows results as they land. */
  app.post("/v1/admin/amazon/:marketplace/listings/check", async (req, reply) => {
    const { marketplace } = Market.parse(req.params);
    const cj = cjClient();
    if (running.has(marketplace)) return reply.code(202).send({ started: false, running: true });
    running.add(marketplace);
    void amazon
      .checkListings(cj, settings(marketplace))
      .catch((e) => req.log.error(e, "amazon listing check failed"))
      .finally(() => running.delete(marketplace));
    return reply.code(202).send({ started: true });
  });

  app.post("/v1/admin/amazon/:marketplace/proposals", async (req) => {
    const { marketplace } = Market.parse(req.params);
    const { cjSkus } = z
      .object({ cjSkus: z.array(z.string().min(3).max(60)).min(1).max(25) })
      .parse(req.body);
    return amazon.propose(cjClient(), settings(marketplace), cjSkus);
  });

  app.post("/v1/admin/amazon/listings/:id/state", async (req) => {
    const { id } = Id.parse(req.params);
    const { state } = z
      .object({ state: z.enum(["APPROVED", "REJECTED", "PROPOSED"]) })
      .parse(req.body);
    return amazon.setProposalState(id, state);
  });

  app.post("/v1/admin/amazon/listings/:id", async (req) => {
    const { id } = Id.parse(req.params);
    const patch = z
      .object({
        cjSku: z.string().max(60).nullable().optional(),
        title: z.string().min(5).max(200).optional(),
        bullets: z.array(z.string().max(500)).max(5).optional(),
        price: z.number().positive().max(100000).nullable().optional(),
      })
      .parse(req.body);
    return amazon.editListing(id, patch);
  });

  app.get("/v1/admin/amazon/:marketplace/files/price-quantity.txt", async (req, reply) => {
    const { marketplace } = Market.parse(req.params);
    return reply
      .type("text/tab-separated-values; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="price-quantity-${marketplace}.txt"`)
      .send(await amazon.priceQuantityFile(marketplace));
  });

  app.get("/v1/admin/amazon/:marketplace/files/new-listings.txt", async (req, reply) => {
    const { marketplace } = Market.parse(req.params);
    return reply
      .type("text/tab-separated-values; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="new-listings-${marketplace}.txt"`)
      .send(await amazon.newListingsFile(marketplace));
  });

  app.get("/v1/admin/amazon/:marketplace/orders", async (req) => {
    const { marketplace } = Market.parse(req.params);
    const q = z.object({ status: z.nativeEnum(AmazonOrderStatus).optional() }).parse(req.query);
    return db.amazonOrder.findMany({
      where: { marketplace, ...(q.status ? { status: q.status } : {}) },
      orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }],
      take: 300,
    });
  });

  app.post(
    "/v1/admin/amazon/:marketplace/orders/import",
    { bodyLimit: REPORT_LIMIT },
    async (req) => {
      const { marketplace } = Market.parse(req.params);
      const { text } = z.object({ text: z.string().min(10).max(REPORT_LIMIT) }).parse(req.body);
      return amazon.importOrders(marketplace, text);
    },
  );

  /** "Order from CJ" and "Reorder from CJ" (force=true re-sends an order already placed). */
  app.post("/v1/admin/amazon/orders/:id/cj", async (req) => {
    const { id } = Id.parse(req.params);
    const { force } = z.object({ force: z.boolean().default(false) }).parse(req.body ?? {});
    const order = await db.amazonOrder.findUniqueOrThrow({ where: { id } });
    if (!isMarketplace(order.marketplace)) throw new Error("INVALID_MARKETPLACE");
    return amazon.orderFromCj(cjClient(), settings(order.marketplace), id, force);
  });

  app.post("/v1/admin/amazon/orders/:id/status", async (req) => {
    const { id } = Id.parse(req.params);
    const b = z
      .object({
        status: z.enum(["SHIPPED", "CANCELLED", "NEW"]),
        tracking: z.string().max(100).optional(),
      })
      .parse(req.body);
    return amazon.setOrderStatus(id, b.status, b.tracking);
  });
}

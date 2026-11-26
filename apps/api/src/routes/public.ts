import { readFile } from "node:fs/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db, EventType } from "@chambelli/database";
import { FeedService } from "@chambelli/feeds";
import { cleanSupplierNotes } from "@chambelli/cj";
import { AnalyticsService } from "@chambelli/analytics";
import { config } from "../config.js";

const widgetPath = new URL("../../public/widget.js", import.meta.url);
let widgetSource: string | null = null;
const canadaPagePath = new URL("../../public/ca.html", import.meta.url);
let canadaPage: string | null = null;
const ukPagePath = new URL("../../public/uk.html", import.meta.url);
let ukPage: string | null = null;
const dePagePath = new URL("../../public/de.html", import.meta.url);
let dePage: string | null = null;
const productPagePath = new URL("../../public/product.html", import.meta.url);
let productPage: string | null = null;
const productScriptPath = new URL("../../public/product.js", import.meta.url);
let productScript: string | null = null;

/** Storefront markets with a product page: /us/p/{slug}, /ca/p/{slug}, /uk/p/{slug}, /de/p/{slug}. */
const MARKETS = {
  us: { market: "US", lang: "en-US", store: "Chambelli" },
  ca: { market: "CA", lang: "en-CA", store: "Chambelli Canada" },
  uk: { market: "UK", lang: "en-GB", store: "Chambelli UK" },
  de: { market: "DE", lang: "en-DE", store: "Chambelli Germany" },
} as const;
type MarketKey = keyof typeof MARKETS;

const html = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/**
 * A product and the site it is sold through. The site comes from ?site= (the carousel that sent
 * the shopper) when it is active and in this market; otherwise the first site carrying it.
 */
async function findProductForSale(slug: string, siteSlug?: string, market?: string) {
  const product = await db.product.findUnique({
    where: { slug },
    include: {
      variants: { where: { active: true }, orderBy: { price: "asc" } },
      assignments: { where: { active: true }, include: { website: true } },
    },
  });
  if (!product || product.status !== "ACTIVE") return null;
  const fits = (w: { active: boolean; market: string } | null | undefined) =>
    !!w && w.active && (!market || w.market === market);
  let site = siteSlug ? await db.website.findUnique({ where: { slug: siteSlug } }) : null;
  if (!fits(site)) site = product.assignments.map((a) => a.website).find(fits) ?? null;
  if (!site) return null;
  const variants = product.variants.filter((v) => v.currency === site.currency);
  return { product, site, variants };
}

function securityHeaders(base: string) {
  let origin = "";
  try {
    origin = new URL(base).origin;
  } catch {
    // a bad PUBLIC_API_BASE_URL falls back to same-origin only
  }
  const self = origin ? `'self' ${origin}` : "'self'";
  return [
    "default-src 'self'",
    // Stripe.js powers the card form (https://docs.stripe.com/security/guide#content-security-policy).
    `script-src ${self} https://js.stripe.com`,
    "style-src 'self' 'unsafe-inline'",
    // Product photos come from CJ's image hosts.
    "img-src 'self' https: data:",
    `connect-src ${self} https://api.stripe.com`,
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

const AnalyticsBody = z.object({
  websiteSlug: z.string().min(1).max(100),
  productId: z.string().uuid().optional(),
  eventType: z.nativeEnum(EventType),
  sessionId: z.string().max(100).optional(),
  placement: z.string().max(100).optional(),
  position: z.number().int().min(1).max(1000).optional(),
  metadata: z
    .record(z.unknown())
    .refine((m) => JSON.stringify(m).length <= 2000, "metadata too large")
    .optional(),
});

export async function publicRoutes(app: FastifyInstance) {
  const feeds = new FeedService();
  const analytics = new AnalyticsService();

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_req, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "database_unavailable" });
    }
  });

  app.get("/v1/carousels/:site/:placement", async (req, reply) => {
    const p = z
      .object({ site: z.string().max(100), placement: z.string().max(100) })
      .parse(req.params);
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(50) })
      .parse(req.query);
    const out = await feeds.get(p.site, p.placement, q.limit);
    if (!out) return reply.code(404).send({ error: "SITE_NOT_FOUND" });
    reply.header("Cache-Control", "public, max-age=60, s-maxage=300");
    // Shoppers never see CJ suppliers' shipping notes in titles (e.g. "TikTok, temu pick-up").
    return {
      ...out,
      products: out.products.map((p) => ({ ...p, title: cleanSupplierNotes(p.title) })),
    };
  });

  app.post(
    "/v1/analytics",
    { bodyLimit: 8 * 1024, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const b = AnalyticsBody.parse(req.body);
      const site = await db.website.findUnique({ where: { slug: b.websiteSlug } });
      if (!site || !site.active) return reply.code(404).send({ error: "SITE_NOT_FOUND" });
      await analytics.track({
        websiteId: site.id,
        productId: b.productId,
        eventType: b.eventType,
        sessionId: b.sessionId,
        placement: b.placement,
        position: b.position,
        metadata: b.metadata,
      });
      return reply.code(202).send({ ok: true });
    },
  );

  /**
   * Chambelli Canada storefront page. Point agent.getservices.ai/ca at this route
   * (reverse proxy); the carousel inside it loads from PUBLIC_API_BASE_URL.
   */
  app.get("/ca", async (req, reply) => {
    canadaPage ??= await readFile(canadaPagePath, "utf8");
    const base = (config.publicApiBaseUrl || `${req.protocol}://${req.host}`).replace(/\/$/, "");
    const safeBase = base.replace(/[&<>"']/g, "");
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(canadaPage.replaceAll("{{API_BASE}}", safeBase));
  });

  /**
   * Chambelli UK storefront page (docs/UK.md). Point agent.getservices.ai/uk at this route;
   * the carousel inside it loads GBP products from PUBLIC_API_BASE_URL.
   */
  app.get("/uk", async (req, reply) => {
    ukPage ??= await readFile(ukPagePath, "utf8");
    const base = (config.publicApiBaseUrl || `${req.protocol}://${req.host}`).replace(/\/$/, "");
    const safeBase = base.replace(/[&<>"']/g, "");
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(ukPage.replaceAll("{{API_BASE}}", safeBase));
  });

  /**
   * Chambelli Germany storefront page (docs/DE.md). Point agent.getservices.ai/de at this route;
   * the carousel inside it loads EUR products from PUBLIC_API_BASE_URL.
   */
  app.get("/de", async (req, reply) => {
    dePage ??= await readFile(dePagePath, "utf8");
    const base = (config.publicApiBaseUrl || `${req.protocol}://${req.host}`).replace(/\/$/, "");
    const safeBase = base.replace(/[&<>"']/g, "");
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(dePage.replaceAll("{{API_BASE}}", safeBase));
  });

  /**
   * Product data for the storefront product page: photo, sizes/options, prices and the site
   * (website id) the cart belongs to.
   */
  app.get("/v1/products/:slug", async (req, reply) => {
    const { slug } = z.object({ slug: z.string().min(1).max(200) }).parse(req.params);
    const q = z
      .object({
        site: z.string().max(100).optional(),
        market: z.enum(["US", "CA", "UK", "DE"]).optional(),
      })
      .parse(req.query);
    const found = await findProductForSale(slug, q.site, q.market);
    if (!found) return reply.code(404).send({ error: "PRODUCT_NOT_FOUND" });
    const { product, site, variants } = found;
    reply.header("Cache-Control", "public, max-age=60");
    return {
      site: {
        id: site.id,
        slug: site.slug,
        name: site.name,
        domain: site.domain,
        market: site.market,
        currency: site.currency,
      },
      product: {
        id: product.id,
        slug: product.slug,
        title: cleanSupplierNotes(product.title),
        description: product.description,
        imageUrl: product.imageUrl,
        category: product.category,
      },
      variants: variants.map((v) => ({
        id: v.id,
        name: v.name,
        price: Number(v.price),
        compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : null,
        currency: v.currency,
        inStock: v.quantity > 0,
      })),
    };
  });

  for (const key of Object.keys(MARKETS) as MarketKey[]) {
    const m = MARKETS[key];
    const sendPage = async (
      req: FastifyRequest,
      reply: FastifyReply,
      meta: { title: string; description: string; image?: string | null; status?: number },
    ) => {
      productPage ??= await readFile(productPagePath, "utf8");
      const base = (config.publicApiBaseUrl || `${req.protocol}://${req.host}`).replace(/\/$/, "");
      const safeBase = base.replace(/[&<>"']/g, "");
      const page = productPage
        .replaceAll("{{API_BASE}}", safeBase)
        .replaceAll("{{MARKET}}", m.market)
        .replaceAll("{{LANG}}", m.lang)
        .replaceAll("{{STORE}}", html(m.store))
        .replaceAll("{{TITLE}}", html(meta.title))
        .replaceAll("{{DESCRIPTION}}", html(meta.description))
        .replaceAll("{{IMAGE}}", html(meta.image ?? ""));
      return reply
        .code(meta.status ?? 200)
        .type("text/html; charset=utf-8")
        .header("Cache-Control", "public, max-age=300")
        .header("Content-Security-Policy", securityHeaders(base))
        .send(page);
    };

    /** Product page every carousel card links to: photo, price, size, add to cart, checkout. */
    app.get(`/${key}/p/:slug`, async (req, reply) => {
      const { slug } = z.object({ slug: z.string().min(1).max(200) }).parse(req.params);
      const { site } = z.object({ site: z.string().max(100).optional() }).parse(req.query);
      const found = await findProductForSale(slug, site, m.market);
      if (!found)
        return sendPage(req, reply, {
          title: `Product not found · ${m.store}`,
          description: "This product is no longer available.",
          status: 404,
        });
      const desc = (found.product.description ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      const title = cleanSupplierNotes(found.product.title);
      return sendPage(req, reply, {
        title: `${title} · ${m.store}`,
        description: desc || `${title}, delivered by ${m.store}.`,
        image: found.product.imageUrl,
      });
    });

    /** PayPal sends the shopper back here; the page captures the payment and shows the result. */
    app.get(`/${key}/checkout/return`, async (req, reply) =>
      sendPage(req, reply, {
        title: `Order status · ${m.store}`,
        description: "Your Chambelli order status.",
      }),
    );
  }

  /** Script for the product and checkout-return pages (same origin, so the page CSP allows it). */
  app.get("/product.js", async (_req, reply) => {
    productScript ??= await readFile(productScriptPath, "utf8");
    return reply
      .type("application/javascript; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .send(productScript);
  });

  /** The embeddable widget, served from the API so sites need only one script tag. */
  app.get("/widget.js", async (_req, reply) => {
    widgetSource ??= await readFile(widgetPath, "utf8");
    return reply
      .type("application/javascript; charset=utf-8")
      .header("Cache-Control", "public, max-age=3600")
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .send(widgetSource);
  });
}

import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, EventType } from "@chambelli/database";
import { FeedService } from "@chambelli/feeds";
import { AnalyticsService } from "@chambelli/analytics";

const widgetPath = new URL("../../public/widget.js", import.meta.url);
let widgetSource: string | null = null;

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
      .object({ limit: z.coerce.number().int().min(1).max(30).default(30) })
      .parse(req.query);
    const out = await feeds.get(p.site, p.placement, q.limit);
    if (!out) return reply.code(404).send({ error: "SITE_NOT_FOUND" });
    reply.header("Cache-Control", "public, max-age=60, s-maxage=300");
    return out;
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

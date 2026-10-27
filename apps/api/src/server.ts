import { commerceRoutes } from "./commerceRoutes.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { z } from "zod";
import { db, EventType } from "@chambelli/database";
import { FeedService } from "@chambelli/feeds";
import { AnalyticsService } from "@chambelli/analytics";
const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(helmet);
const feeds = new FeedService(),
  analytics = new AnalyticsService();
await app.register(commerceRoutes);
app.get("/health", async () => ({ status: "ok" }));
app.get("/v1/carousels/:site/:placement", async (req, reply) => {
  const p = z.object({ site: z.string(), placement: z.string() }).parse(req.params);
  const out = await feeds.get(p.site, p.placement, 30);
  if (!out) return reply.code(404).send({ error: "SITE_NOT_FOUND" });
  return out;
});
app.post("/v1/analytics", async (req, reply) => {
  const b = z
    .object({
      websiteSlug: z.string(),
      productId: z.string().optional(),
      eventType: z.nativeEnum(EventType),
      sessionId: z.string().optional(),
      placement: z.string().optional(),
      position: z.number().int().optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .parse(req.body);
  const site = await db.website.findUnique({ where: { slug: b.websiteSlug } });
  if (!site) return reply.code(404).send({ error: "SITE_NOT_FOUND" });
  await analytics.track({
    websiteId: site.id,
    productId: b.productId,
    eventType: b.eventType,
    sessionId: b.sessionId,
    placement: b.placement,
    position: b.position,
    metadata: b.metadata,
  });
  return { ok: true };
});
app.get("/v1/admin/products", async (req, reply) => {
  if (req.headers["x-admin-key"] !== process.env.ADMIN_API_KEY)
    return reply.code(401).send({ error: "UNAUTHORIZED" });
  return db.product.findMany({
    include: { variants: true, assignments: true },
    orderBy: { updatedAt: "desc" },
  });
});
app.get("/v1/admin/websites", async (req, reply) => {
  if (req.headers["x-admin-key"] !== process.env.ADMIN_API_KEY)
    return reply.code(401).send({ error: "UNAUTHORIZED" });
  return db.website.findMany({ orderBy: { name: "asc" } });
});
app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" });

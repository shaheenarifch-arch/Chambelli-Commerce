import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@chambelli/database";
import { CommerceReports } from "@chambelli/reporting";
import { requireAdmin } from "../auth.js";
import { config } from "../config.js";

const Page = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin(config.adminApiKey));
  const reports = new CommerceReports();

  app.get("/v1/admin/products", async (req) => {
    const { limit, offset } = Page.parse(req.query);
    const [items, total] = await Promise.all([
      db.product.findMany({
        include: { variants: true, assignments: true, score: true },
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      db.product.count(),
    ]);
    return { items, total, limit, offset };
  });

  app.get("/v1/admin/websites", async () => {
    return db.website.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { assignments: true } } },
    });
  });

  app.get("/v1/admin/overview", async (req) => {
    const q = z
      .object({ days: z.coerce.number().int().min(1).max(365).default(30) })
      .parse(req.query);
    const to = new Date();
    const from = new Date(to.getTime() - q.days * 86_400_000);
    const [sales, productsByStatus, websites, events, lastSync] = await Promise.all([
      reports.overview(from, to),
      db.product.groupBy({ by: ["status"], _count: true }),
      db.website.count({ where: { active: true } }),
      db.analyticsEvent.groupBy({
        by: ["eventType"],
        where: { createdAt: { gte: from, lt: to } },
        _count: true,
      }),
      db.syncJob.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);
    return {
      days: q.days,
      sales,
      products: Object.fromEntries(productsByStatus.map((r) => [r.status, r._count])),
      activeWebsites: websites,
      events: Object.fromEntries(events.map((r) => [r.eventType, r._count])),
      lastSync,
    };
  });
}

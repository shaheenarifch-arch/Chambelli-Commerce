import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { errorHandler } from "./errors.js";
import { publicRoutes } from "./routes/public.js";
import { adminRoutes } from "./routes/admin.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { commerceRoutes } from "./commerceRoutes.js";

export async function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify({
    logger: true,
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
    ...opts,
  });
  app.setErrorHandler(errorHandler);

  await app.register(helmet, { crossOriginResourcePolicy: { policy: "cross-origin" } });
  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "x-admin-key"],
  });
  await app.register(rateLimit, { max: config.rateLimitPerMinute, timeWindow: "1 minute" });

  await app.register(publicRoutes);
  await app.register(commerceRoutes);
  await app.register(adminRoutes);
  await app.register(webhookRoutes);
  return app;
}

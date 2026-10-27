import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { MIN_ADMIN_KEY_LENGTH } from "./config.js";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/**
 * Constant-time comparison of the presented key against the configured one.
 * An unset or short ADMIN_API_KEY never grants access.
 */
export function isValidAdminKey(presented: unknown, configured: string): boolean {
  if (!configured || configured.length < MIN_ADMIN_KEY_LENGTH) return false;
  if (typeof presented !== "string" || !presented) return false;
  return timingSafeEqual(digest(presented), digest(configured));
}

export function requireAdmin(configured: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!configured || configured.length < MIN_ADMIN_KEY_LENGTH) {
      return reply.code(503).send({ error: "ADMIN_NOT_CONFIGURED" });
    }
    if (!isValidAdminKey(req.headers["x-admin-key"], configured)) {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
  };
}

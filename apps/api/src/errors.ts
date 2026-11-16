import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

/** Business errors thrown by the packages, mapped to HTTP status codes. */
const KNOWN_ERRORS: Record<string, number> = {
  INVALID_QUANTITY: 400,
  INVALID_RETURN_ITEMS: 400,
  INVALID_WEBHOOK_SIGNATURE: 400,
  INVALID_PROVINCE: 400,
  SITE_SHIPPING_COST_NOT_SET: 409,
  UK_PRICING_NOT_SET: 409,
  INVALID_MARKETPLACE: 400,
  REPORT_MISSING_SELLER_SKU: 400,
  REPORT_NOT_UNSHIPPED_ORDERS: 400,
  CJ_NOT_CONFIGURED: 503,
  CJ_LOGISTIC_NOT_SET: 409,
  CJ_SKU_MISSING: 409,
  ADDRESS_INCOMPLETE: 409,
  ALREADY_SENT_TO_CJ: 409,
  ORDER_CLOSED: 409,
  WRONG_MARKETPLACE: 409,
  LISTING_ALREADY_LIVE: 409,
  PRICE_BELOW_MARGIN: 409,
  CJ_ORDER_FAILED: 502,
  INVALID_POSTAL_CODE: 400,
  SHIPPING_COUNTRY_NOT_SUPPORTED: 400,
  ORDER_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  WEBSITE_NOT_FOUND: 404,
  INSUFFICIENT_STOCK: 409,
  INVENTORY_CHANGED: 409,
  CART_NOT_ORDERABLE: 409,
  ORDER_ALREADY_PAID: 409,
  CURRENCY_MISMATCH: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  RETURN_NOT_AVAILABLE: 409,
  PROMOTION_NOT_ELIGIBLE: 422,
};

export function errorHandler(error: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: "VALIDATION_FAILED",
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const status = KNOWN_ERRORS[error.message];
  if (status) return reply.code(status).send({ error: error.message });

  const code = (error as { code?: string }).code;
  if (code === "P2025") return reply.code(404).send({ error: "NOT_FOUND" });
  if (code === "P2002") return reply.code(409).send({ error: "ALREADY_EXISTS" });

  if (error.statusCode && error.statusCode < 500) {
    return reply
      .code(error.statusCode)
      .send({ error: error.code ?? "BAD_REQUEST", message: error.message });
  }
  // Unexpected: log the detail, return nothing sensitive.
  req.log.error({ err: error }, "unhandled error");
  return reply.code(500).send({ error: "INTERNAL_ERROR" });
}

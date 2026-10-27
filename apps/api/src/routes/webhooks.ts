import type { FastifyInstance } from "fastify";
import { StripePayments } from "@chambelli/payments";
import { OrderService } from "@chambelli/orders";
import { config } from "../config.js";
import { paypalClient } from "../commerceRoutes.js";

/**
 * Payment provider webhooks. Orders are marked paid ONLY here (or after a
 * server-side PayPal capture), never on the shopper's word.
 * This plugin keeps request bodies raw so signatures can be verified.
 */
export async function webhookRoutes(app: FastifyInstance) {
  const orders = new OrderService();
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );

  app.post("/v1/webhooks/stripe", { config: { rateLimit: false } }, async (req, reply) => {
    const { secretKey, webhookSecret } = config.stripe;
    if (!secretKey || !webhookSecret)
      return reply.code(503).send({ error: "STRIPE_NOT_CONFIGURED" });
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") return reply.code(400).send({ error: "MISSING_SIGNATURE" });
    const outcome = await new StripePayments(secretKey).handleWebhook(
      req.body as Buffer,
      signature,
      webhookSecret,
    );
    if (outcome.kind === "succeeded") {
      const result = await orders.finalizePayment(outcome.orderId);
      req.log.info({ result }, "stripe payment finalized");
    }
    return { received: true };
  });

  app.post("/v1/webhooks/paypal", { config: { rateLimit: false } }, async (req, reply) => {
    const paypal = paypalClient();
    if (!paypal || !config.paypal.webhookId)
      return reply.code(503).send({ error: "PAYPAL_NOT_CONFIGURED" });
    let event: unknown;
    try {
      event = JSON.parse((req.body as Buffer).toString("utf8"));
    } catch {
      return reply.code(400).send({ error: "INVALID_JSON" });
    }
    const verified = await paypal.verifyWebhook(req.headers, event, config.paypal.webhookId);
    if (!verified) return reply.code(400).send({ error: "INVALID_WEBHOOK_SIGNATURE" });
    const outcome = await paypal.handleVerifiedEvent(
      event as Parameters<typeof paypal.handleVerifiedEvent>[0],
    );
    if (outcome.kind === "succeeded") {
      const result = await orders.finalizePayment(outcome.orderId);
      req.log.info({ result }, "paypal payment finalized");
    }
    return { received: true };
  });
}

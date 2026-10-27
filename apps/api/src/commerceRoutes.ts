import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, OrderStatus, PaymentProvider } from "@chambelli/database";
import { CartService } from "@chambelli/cart";
import { OrderService } from "@chambelli/orders";
import { PromotionService } from "@chambelli/promotions";
import { StripePayments, PayPalPayments } from "@chambelli/payments";
import { ReturnService } from "@chambelli/returns";
import { config } from "./config.js";

const AddItem = z.object({
  sessionId: z.string().min(8).max(100),
  websiteId: z.string().uuid(),
  currency: z.string().length(3).toUpperCase(),
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
});

const Checkout = z.object({
  cartId: z.string().uuid(),
  websiteId: z.string().uuid(),
  customerEmail: z.string().email().max(254),
  customerName: z.string().max(200).optional(),
  address: z.object({
    name: z.string().min(1).max(200),
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).optional(),
    city: z.string().min(1).max(100),
    region: z.string().max(100).optional(),
    postalCode: z.string().min(1).max(20),
    country: z.string().length(2).toUpperCase(),
    phone: z.string().max(40).optional(),
  }),
  promotionCode: z.string().max(50).optional(),
  paymentProvider: z.nativeEnum(PaymentProvider),
  idempotencyKey: z.string().min(10).max(100),
});

const ReturnBody = z.object({
  orderId: z.string().uuid(),
  email: z.string().email(),
  reason: z.string().min(3).max(1000),
  items: z
    .array(
      z.object({ orderItemId: z.string().uuid(), quantity: z.number().int().positive().max(100) }),
    )
    .min(1)
    .max(50),
});

export function paypalClient() {
  const { clientId, clientSecret, baseUrl } = config.paypal;
  return clientId && clientSecret && baseUrl
    ? new PayPalPayments({ clientId, clientSecret, baseUrl })
    : null;
}

export async function commerceRoutes(app: FastifyInstance) {
  const carts = new CartService();
  const orders = new OrderService();
  const promos = new PromotionService();
  const strict = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

  app.post("/v1/cart/items", async (req) => {
    const b = AddItem.parse(req.body);
    const site = await db.website.findUnique({ where: { id: b.websiteId } });
    if (!site || !site.active) throw new Error("WEBSITE_NOT_FOUND");
    const cart = await carts.getOrCreate(b.sessionId, b.websiteId, b.currency);
    await carts.add(cart.id, b.variantId, b.quantity);
    return carts.summary(cart.id);
  });

  app.get("/v1/cart/:cartId", async (req) => {
    const { cartId } = z.object({ cartId: z.string().uuid() }).parse(req.params);
    return carts.summary(cartId);
  });

  app.post("/v1/checkout", strict, async (req, reply) => {
    const b = Checkout.parse(req.body);
    if (b.paymentProvider === PaymentProvider.STRIPE && !config.stripe.secretKey)
      return reply.code(503).send({ error: "STRIPE_NOT_CONFIGURED" });
    const paypal = paypalClient();
    if (b.paymentProvider === PaymentProvider.PAYPAL && !paypal)
      return reply.code(503).send({ error: "PAYPAL_NOT_CONFIGURED" });

    const summary = await carts.summary(b.cartId);
    let discount = 0;
    let promotionCode: string | undefined;
    if (b.promotionCode) {
      const p = await promos.apply(b.promotionCode, summary.subtotal);
      discount = p.discount;
      promotionCode = p.promotion.code;
    }
    const customer = await db.customer.upsert({
      where: { email: b.customerEmail.toLowerCase() },
      create: { email: b.customerEmail.toLowerCase(), name: b.customerName },
      update: b.customerName ? { name: b.customerName } : {},
    });
    const address = await db.address.create({ data: { ...b.address, customerId: customer.id } });
    // Shipping and tax stay at zero until real quote services are connected (see docs/PART2.md).
    const order = await orders.createFromCart({
      cartId: b.cartId,
      websiteId: b.websiteId,
      customerId: customer.id,
      shippingAddressId: address.id,
      idempotencyKey: b.idempotencyKey,
      promotionCode,
      discount,
      shipping: 0,
      tax: 0,
    });
    if (order.status !== OrderStatus.PENDING_PAYMENT) throw new Error("ORDER_ALREADY_PAID");

    const payment =
      b.paymentProvider === PaymentProvider.STRIPE
        ? await new StripePayments(config.stripe.secretKey).create(
            order.id,
            `stripe-${b.idempotencyKey}`,
          )
        : await paypal!.create(order.id, `paypal-${b.idempotencyKey}`);
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: Number(order.total),
      currency: order.currency,
      ...payment,
    };
  });

  /** Called by the storefront after the shopper approves the PayPal payment. */
  app.post("/v1/payments/paypal/:paypalOrderId/capture", strict, async (req, reply) => {
    const { paypalOrderId } = z
      .object({ paypalOrderId: z.string().min(5).max(50) })
      .parse(req.params);
    const paypal = paypalClient();
    if (!paypal) return reply.code(503).send({ error: "PAYPAL_NOT_CONFIGURED" });
    const outcome = await paypal.capture(paypalOrderId);
    if (outcome.kind !== "succeeded")
      return reply.code(402).send({ error: "PAYMENT_NOT_COMPLETED" });
    const result = await orders.finalizePayment(outcome.orderId);
    return { orderId: outcome.orderId, status: result.status };
  });

  app.post("/v1/returns", strict, async (req) => {
    const b = ReturnBody.parse(req.body);
    const r = await new ReturnService().request(b.orderId, b.email, b.reason, b.items);
    return { id: r.id, status: r.status };
  });
}

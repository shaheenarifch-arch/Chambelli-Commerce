import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db, OrderStatus, PaymentProvider } from "@chambelli/database";
import { CartService } from "@chambelli/cart";
import { OrderService } from "@chambelli/orders";
import { PromotionService } from "@chambelli/promotions";
import { StripePayments, PayPalPayments } from "@chambelli/payments";
import { ReturnService } from "@chambelli/returns";
import {
  canadaTaxRate,
  normalizePostalCode,
  normalizeUkPostcode,
  normalizeDePostcode,
  provinceCode,
} from "@chambelli/pricing";
import { config } from "./config.js";

const AddItem = z.object({
  sessionId: z.string().min(8).max(100),
  websiteId: z.string().uuid(),
  /** Ignored: the charge currency always comes from the website, never the browser. */
  currency: z.string().length(3).optional(),
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

/** The storefront page PayPal sends the shopper back to (built here, never taken from the browser). */
function paypalReturnUrls(req: FastifyRequest, site: { market: string; slug: string }) {
  const base = (config.publicApiBaseUrl || `${req.protocol}://${req.host}`).replace(/\/$/, "");
  const market = site.market.toLowerCase();
  const back = `${base}/${encodeURIComponent(market)}/checkout/return?site=${encodeURIComponent(site.slug)}`;
  return { returnUrl: back, cancelUrl: `${back}&cancelled=1` };
}

export function paypalClient() {
  const { clientId, clientSecret, baseUrl } = config.paypal;
  return clientId && clientSecret && baseUrl
    ? new PayPalPayments({ clientId, clientSecret, baseUrl })
    : null;
}

export type PaymentMode = "off" | "sandbox" | "live";

/**
 * Whether each payment provider is switched off, in sandbox/test mode (no real money moves) or
 * live. Read from the keys themselves so the storefront can warn before real buyers check out.
 */
export function paymentModes(): { paypal: PaymentMode; stripe: PaymentMode } {
  const { clientId, clientSecret, baseUrl } = config.paypal;
  const paypal: PaymentMode =
    !clientId || !clientSecret || !baseUrl ? "off" : /sandbox/i.test(baseUrl) ? "sandbox" : "live";
  const key = config.stripe.secretKey;
  const stripe: PaymentMode = !key ? "off" : /^(sk|rk)_live_/.test(key) ? "live" : "sandbox";
  return { paypal, stripe };
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
    const cart = await carts.getOrCreate(b.sessionId, b.websiteId, site.currency);
    await carts.add(cart.id, b.variantId, b.quantity);
    return carts.summary(cart.id);
  });

  app.get("/v1/cart/:cartId", async (req) => {
    const { cartId } = z.object({ cartId: z.string().uuid() }).parse(req.params);
    return carts.summary(cartId);
  });

  /**
   * Checkout order summary: sets an item's quantity; 0 removes it. POST (not PATCH/DELETE) so the
   * storefront's existing CORS rules cover it. Answers with the whole cart, like POST /v1/cart/items.
   */
  app.post("/v1/cart/:cartId/items/:variantId", async (req) => {
    const { cartId, variantId } = z
      .object({ cartId: z.string().uuid(), variantId: z.string().uuid() })
      .parse(req.params);
    const { quantity } = z.object({ quantity: z.number().int().min(0).max(20) }).parse(req.body);
    await carts.setQuantity(cartId, variantId, quantity);
    return carts.summary(cartId);
  });

  /** Public: lets the storefront show a test-mode notice, or hide checkout when payments are off. */
  app.get("/v1/payments/status", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    const modes = paymentModes();
    // The storefront's card form needs Stripe's public key; it is safe to share.
    const pk = config.stripe.publishableKey;
    return modes.stripe !== "off" && pk ? { ...modes, stripePublishableKey: pk } : modes;
  });

  app.post("/v1/checkout", strict, async (req, reply) => {
    const b = Checkout.parse(req.body);
    if (b.paymentProvider === PaymentProvider.STRIPE && !config.stripe.secretKey)
      return reply.code(503).send({ error: "STRIPE_NOT_CONFIGURED" });
    const paypal = paypalClient();
    if (b.paymentProvider === PaymentProvider.PAYPAL && !paypal)
      return reply.code(503).send({ error: "PAYPAL_NOT_CONFIGURED" });

    const site = await db.website.findUnique({ where: { id: b.websiteId } });
    if (!site || !site.active) throw new Error("WEBSITE_NOT_FOUND");
    // Canada chapter: ships only within Canada, with a valid province and postal code.
    let taxRatePercent: number | undefined;
    if (site.market === "CA") {
      if (b.address.country !== "CA") throw new Error("SHIPPING_COUNTRY_NOT_SUPPORTED");
      const province = provinceCode(b.address.region);
      if (!province) throw new Error("INVALID_PROVINCE");
      const postalCode = normalizePostalCode(b.address.postalCode);
      if (!postalCode) throw new Error("INVALID_POSTAL_CODE");
      b.address.region = province;
      b.address.postalCode = postalCode;
      taxRatePercent = canadaTaxRate(province, config.canada.gstHstRegistered);
    }
    // UK chapter (docs/UK.md): ships only within the UK, charged in GBP. Prices already include
    // delivery and any VAT (UK shoppers must see VAT-inclusive prices), so nothing is added here.
    if (site.market === "UK") {
      if (b.address.country === "UK") b.address.country = "GB";
      if (b.address.country !== "GB") throw new Error("SHIPPING_COUNTRY_NOT_SUPPORTED");
      const postcode = normalizeUkPostcode(b.address.postalCode);
      if (!postcode) throw new Error("INVALID_POSTAL_CODE");
      b.address.postalCode = postcode;
    }
    // Germany chapter (docs/DE.md): ships only within Germany, charged in EUR. Prices already
    // include delivery and any VAT (German shoppers must see VAT-inclusive prices).
    if (site.market === "DE") {
      if (b.address.country !== "DE") throw new Error("SHIPPING_COUNTRY_NOT_SUPPORTED");
      const postcode = normalizeDePostcode(b.address.postalCode);
      if (!postcode) throw new Error("INVALID_POSTAL_CODE");
      b.address.postalCode = postcode;
    }

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
      // Never let an anonymous checkout rename an existing customer.
      update: {},
    });
    const address = await db.address.create({ data: { ...b.address, customerId: customer.id } });
    // Shipping stays at zero (Canadian, UK and German prices include it). Tax is zero except GST/HST on the
    // Canada site once registered; US tax still needs a quote service (see docs/PART2.md).
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
      taxRatePercent,
    });
    if (order.status !== OrderStatus.PENDING_PAYMENT) throw new Error("ORDER_ALREADY_PAID");

    const payment =
      b.paymentProvider === PaymentProvider.STRIPE
        ? await new StripePayments(config.stripe.secretKey).create(
            order.id,
            `stripe-${b.idempotencyKey}`,
          )
        : await paypal!.create(order.id, `paypal-${b.idempotencyKey}`, paypalReturnUrls(req, site));
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
    if (outcome.kind === "pending")
      return reply.code(202).send({ orderId: outcome.orderId, status: "PAYMENT_PENDING" });
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

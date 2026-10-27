import Stripe from "stripe";
import { db, PaymentProvider, PaymentStatus } from "@chambelli/database";

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

/** What a verified provider event means for our records. */
export type PaymentOutcome =
  | { kind: "succeeded"; orderId: string; paymentId: string }
  | { kind: "failed"; orderId: string; paymentId: string }
  | { kind: "pending"; orderId: string; paymentId: string }
  | { kind: "ignored"; reason: string };

/** Decimal places a currency uses (USD 2, JPY 0, KWD 3). */
export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Amounts are compared in minor units to avoid floating point drift. */
export function toMinor(amount: unknown, currency: string): number {
  return Math.round(Number(amount) * 10 ** currencyDigits(currency));
}

async function findPayment(provider: PaymentProvider, providerPaymentId: string) {
  return db.payment.findFirst({ where: { provider, providerPaymentId } });
}

async function setPaymentStatus(id: string, status: PaymentStatus, metadata?: object) {
  await db.payment.update({
    where: { id },
    data: { status, ...(metadata ? { metadata: metadata as object } : {}) },
  });
}

export class StripePayments {
  private stripe: Stripe;

  constructor(key: string) {
    this.stripe = new Stripe(key);
  }

  async create(orderId: string, idempotencyKey: string) {
    // A retried checkout reuses the same PaymentIntent instead of failing on
    // the unique idempotency key.
    const existing = await db.payment.findUnique({ where: { idempotencyKey } });
    if (existing?.providerPaymentId) {
      const intent = await this.stripe.paymentIntents.retrieve(existing.providerPaymentId);
      return { provider: "stripe", clientSecret: intent.client_secret, paymentId: intent.id };
    }
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: toMinor(order.total, order.currency),
        currency: order.currency.toLowerCase(),
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey },
    );
    await db.payment.create({
      data: {
        orderId,
        provider: PaymentProvider.STRIPE,
        providerPaymentId: intent.id,
        status: PaymentStatus.PENDING,
        amount: order.total,
        currency: order.currency,
        idempotencyKey,
      },
    });
    return { provider: "stripe", clientSecret: intent.client_secret, paymentId: intent.id };
  }

  /**
   * Verify a Stripe webhook signature against the raw request body, then
   * record the outcome. Throws INVALID_WEBHOOK_SIGNATURE on a bad signature.
   */
  async handleWebhook(rawBody: Buffer, signature: string, secret: string): Promise<PaymentOutcome> {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new Error("INVALID_WEBHOOK_SIGNATURE");
    }
    if (
      event.type !== "payment_intent.succeeded" &&
      event.type !== "payment_intent.payment_failed" &&
      event.type !== "payment_intent.canceled"
    ) {
      return { kind: "ignored", reason: `unhandled event ${event.type}` };
    }
    const intent = event.data.object as Stripe.PaymentIntent;
    const payment = await findPayment(PaymentProvider.STRIPE, intent.id);
    if (!payment) return { kind: "ignored", reason: "unknown payment intent" };

    if (event.type === "payment_intent.succeeded") {
      const paidMinor = intent.amount_received ?? intent.amount;
      if (
        paidMinor !== toMinor(payment.amount, payment.currency) ||
        intent.currency.toUpperCase() !== payment.currency.toUpperCase()
      ) {
        await setPaymentStatus(payment.id, PaymentStatus.FAILED, {
          reason: "AMOUNT_MISMATCH",
          paidMinor,
          currency: intent.currency,
        });
        return { kind: "failed", orderId: payment.orderId, paymentId: payment.id };
      }
      if (payment.status !== PaymentStatus.SUCCEEDED)
        await setPaymentStatus(payment.id, PaymentStatus.SUCCEEDED);
      return { kind: "succeeded", orderId: payment.orderId, paymentId: payment.id };
    }
    // Events can arrive out of order: never move a confirmed payment back to failed.
    if (payment.status === PaymentStatus.SUCCEEDED)
      return { kind: "ignored", reason: "payment already succeeded" };
    await setPaymentStatus(
      payment.id,
      event.type === "payment_intent.canceled" ? PaymentStatus.CANCELED : PaymentStatus.FAILED,
    );
    return { kind: "failed", orderId: payment.orderId, paymentId: payment.id };
  }
}

export class PayPalPayments {
  constructor(private c: PayPalConfig) {}

  private async token(): Promise<string> {
    const b = Buffer.from(`${this.c.clientId}:${this.c.clientSecret}`).toString("base64");
    const r = await fetch(`${this.c.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${b}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!r.ok) throw new Error(`PAYPAL_AUTH_${r.status}`);
    return ((await r.json()) as { access_token: string }).access_token;
  }

  async create(orderId: string, idempotencyKey: string) {
    const existing = await db.payment.findUnique({ where: { idempotencyKey } });
    if (existing?.providerPaymentId) {
      const meta = (existing.metadata ?? {}) as { approveUrl?: string };
      return {
        provider: "paypal",
        paymentId: existing.providerPaymentId,
        approveUrl: meta.approveUrl,
      };
    }
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const token = await this.token();
    const r = await fetch(`${this.c.baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "PayPal-Request-Id": idempotencyKey,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: order.id,
            custom_id: order.id,
            invoice_id: order.orderNumber,
            amount: {
              currency_code: order.currency,
              value: Number(order.total).toFixed(currencyDigits(order.currency)),
            },
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(`PAYPAL_CREATE_${r.status}`);
    const p = (await r.json()) as { id: string; links?: Array<{ rel: string; href: string }> };
    const approveUrl = p.links?.find((x) => x.rel === "approve" || x.rel === "payer-action")?.href;
    await db.payment.create({
      data: {
        orderId,
        provider: PaymentProvider.PAYPAL,
        providerPaymentId: p.id,
        status: PaymentStatus.PENDING,
        amount: order.total,
        currency: order.currency,
        idempotencyKey,
        metadata: { approveUrl },
      },
    });
    return { provider: "paypal", paymentId: p.id, approveUrl };
  }

  /**
   * Capture an approved PayPal order from our server. Because we talk to
   * PayPal directly, the result is trustworthy without a webhook.
   */
  async capture(paypalOrderId: string): Promise<PaymentOutcome> {
    const payment = await findPayment(PaymentProvider.PAYPAL, paypalOrderId);
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    if (payment.status === PaymentStatus.SUCCEEDED)
      return { kind: "succeeded", orderId: payment.orderId, paymentId: payment.id };

    const token = await this.token();
    const r = await fetch(
      `${this.c.baseUrl}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "PayPal-Request-Id": `capture-${payment.id}`,
        },
      },
    );
    const body = (await r.json().catch(() => ({}))) as {
      status?: string;
      purchase_units?: Array<{
        payments?: {
          captures?: Array<{ status: string; amount: { value: string; currency_code: string } }>;
        };
      }>;
    };
    if (!r.ok && body.status !== "COMPLETED") {
      // Already captured elsewhere (e.g. the webhook won the race): let the webhook record it.
      if (r.status === 422)
        return { kind: "pending", orderId: payment.orderId, paymentId: payment.id };
      throw new Error(`PAYPAL_CAPTURE_${r.status}`);
    }
    return this.recordCapture(payment, body);
  }

  /** Verify a PayPal webhook with PayPal's own verification API. */
  async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    event: unknown,
    webhookId: string,
  ) {
    const h = (k: string) => {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    };
    const token = await this.token();
    const r = await fetch(`${this.c.baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        auth_algo: h("paypal-auth-algo"),
        cert_url: h("paypal-cert-url"),
        transmission_id: h("paypal-transmission-id"),
        transmission_sig: h("paypal-transmission-sig"),
        transmission_time: h("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      }),
    });
    if (!r.ok) return false;
    return ((await r.json()) as { verification_status?: string }).verification_status === "SUCCESS";
  }

  /** Handle an already-verified PayPal webhook event. */
  async handleVerifiedEvent(event: {
    event_type?: string;
    resource?: {
      status?: string;
      amount?: { value: string; currency_code: string };
      supplementary_data?: { related_ids?: { order_id?: string } };
    };
  }): Promise<PaymentOutcome> {
    const paypalOrderId = event.resource?.supplementary_data?.related_ids?.order_id;
    if (!paypalOrderId) return { kind: "ignored", reason: "no related order id" };
    const payment = await findPayment(PaymentProvider.PAYPAL, paypalOrderId);
    if (!payment) return { kind: "ignored", reason: "unknown order" };

    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && event.resource?.amount) {
      // The verified event carries the capture itself; record it rather than capturing again.
      return this.recordCaptureResult(payment, {
        status: "COMPLETED",
        amount: event.resource.amount,
      });
    }
    if (
      event.event_type === "PAYMENT.CAPTURE.DENIED" ||
      event.event_type === "PAYMENT.CAPTURE.DECLINED"
    ) {
      if (payment.status === PaymentStatus.SUCCEEDED)
        return { kind: "ignored", reason: "payment already succeeded" };
      await setPaymentStatus(payment.id, PaymentStatus.FAILED);
      return { kind: "failed", orderId: payment.orderId, paymentId: payment.id };
    }
    return { kind: "ignored", reason: `unhandled event ${event.event_type}` };
  }

  private async recordCapture(
    payment: { id: string; orderId: string; amount: unknown; currency: string; status: string },
    body: {
      status?: string;
      purchase_units?: Array<{
        payments?: {
          captures?: Array<{ status: string; amount: { value: string; currency_code: string } }>;
        };
      }>;
    },
  ): Promise<PaymentOutcome> {
    const capture = body.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture) {
      await setPaymentStatus(payment.id, PaymentStatus.FAILED, { paypalStatus: body.status });
      return { kind: "failed", orderId: payment.orderId, paymentId: payment.id };
    }
    return this.recordCaptureResult(payment, capture);
  }

  private async recordCaptureResult(
    payment: { id: string; orderId: string; amount: unknown; currency: string; status: string },
    capture: { status: string; amount: { value: string; currency_code: string } },
  ): Promise<PaymentOutcome> {
    if (payment.status === PaymentStatus.SUCCEEDED)
      return { kind: "succeeded", orderId: payment.orderId, paymentId: payment.id };
    // PENDING means PayPal is still reviewing; the CAPTURE.COMPLETED webhook finishes it later.
    if (capture.status === "PENDING")
      return { kind: "pending", orderId: payment.orderId, paymentId: payment.id };
    if (capture.status !== "COMPLETED") {
      await setPaymentStatus(payment.id, PaymentStatus.FAILED, { paypalStatus: capture.status });
      return { kind: "failed", orderId: payment.orderId, paymentId: payment.id };
    }
    if (
      toMinor(capture.amount.value, payment.currency) !==
        toMinor(payment.amount, payment.currency) ||
      capture.amount.currency_code.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      await setPaymentStatus(payment.id, PaymentStatus.FAILED, { reason: "AMOUNT_MISMATCH" });
      return { kind: "failed", orderId: payment.orderId, paymentId: payment.id };
    }
    await setPaymentStatus(payment.id, PaymentStatus.SUCCEEDED);
    return { kind: "succeeded", orderId: payment.orderId, paymentId: payment.id };
  }
}

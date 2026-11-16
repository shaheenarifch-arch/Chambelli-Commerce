import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.ADMIN_API_KEY = "test-admin-key-0123456789abcdef";
process.env.REDIS_URL = "";
process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
process.env.PUBLIC_API_BASE_URL = "https://api.example.com/";

const ukSite = {
  id: "11111111-1111-4111-8111-111111111111",
  active: true,
  market: "UK",
  currency: "GBP",
};
const db = {
  website: { findUnique: vi.fn(async () => ukSite), findMany: vi.fn(async () => []) },
};
vi.mock("@chambelli/database", () => ({
  db,
  EventType: {},
  PaymentProvider: { STRIPE: "STRIPE", PAYPAL: "PAYPAL" },
  PaymentStatus: {},
  OrderStatus: {},
  CartStatus: {},
  ProductStatus: {},
  PromotionType: {},
  Prisma: {},
}));

const { buildApp } = await import("../apps/api/src/app.js");
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ logger: false });
});
afterAll(() => app.close());

const checkout = (address: Record<string, string>) =>
  app.inject({
    method: "POST",
    url: "/v1/checkout",
    payload: {
      cartId: "22222222-2222-4222-8222-222222222222",
      websiteId: ukSite.id,
      customerEmail: "shopper@example.com",
      address: { name: "Test Shopper", line1: "1 High St", city: "London", ...address },
      paymentProvider: "STRIPE",
      idempotencyKey: "idem-key-123456",
    },
  });

describe("Chambelli UK checkout", () => {
  it("only ships to UK addresses", async () => {
    const res = await checkout({ postalCode: "M5V 2T6", country: "CA" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("SHIPPING_COUNTRY_NOT_SUPPORTED");
  });

  it("requires a valid UK postcode", async () => {
    const res = await checkout({ postalCode: "12345", country: "GB" });
    expect(res.json().error).toBe("INVALID_POSTAL_CODE");
  });

  it("accepts UK as the country code and a lower-case postcode", async () => {
    const res = await checkout({ postalCode: "sw1a1aa", country: "UK" });
    expect(res.json().error).not.toBe("SHIPPING_COUNTRY_NOT_SUPPORTED");
    expect(res.json().error).not.toBe("INVALID_POSTAL_CODE");
  });
});

describe("Chambelli UK storefront page", () => {
  it("is served with the carousel pointed at the public API", async () => {
    const res = await app.inject("/uk");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-site="chambelli-uk"');
    expect(res.body).toContain('src="https://api.example.com/widget.js"');
    expect(res.body).not.toContain("{{API_BASE}}");
  });
});

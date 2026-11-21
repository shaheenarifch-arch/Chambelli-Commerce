import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.ADMIN_API_KEY = "test-admin-key-0123456789abcdef";
process.env.REDIS_URL = "";
process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
process.env.PUBLIC_API_BASE_URL = "https://api.example.com/";

const deSite = {
  id: "11111111-1111-4111-8111-111111111111",
  active: true,
  market: "DE",
  currency: "EUR",
  shipTo: [] as string[],
};
const db = {
  website: { findUnique: vi.fn(async () => deSite), findMany: vi.fn(async () => []) },
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
      websiteId: deSite.id,
      customerEmail: "shopper@example.com",
      address: { name: "Test Shopper", line1: "Hauptstr. 1", city: "Berlin", ...address },
      paymentProvider: "STRIPE",
      idempotencyKey: "idem-key-123456",
    },
  });

describe("Chambelli Germany checkout", () => {
  it("only ships to addresses in Germany", async () => {
    const res = await checkout({ postalCode: "SW1A 1AA", country: "GB" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("SHIPPING_COUNTRY_NOT_SUPPORTED");
  });

  it("requires a valid five-digit postcode", async () => {
    const res = await checkout({ postalCode: "1011", country: "DE" });
    expect(res.json().error).toBe("INVALID_POSTAL_CODE");
  });

  it("accepts a German address", async () => {
    const res = await checkout({ postalCode: "10115", country: "DE" });
    expect(res.json().error).not.toBe("SHIPPING_COUNTRY_NOT_SUPPORTED");
    expect(res.json().error).not.toBe("INVALID_POSTAL_CODE");
  });
});

describe("Germany-chapter site delivering to France and Poland (jewllery.store)", () => {
  it("accepts French and Polish addresses but not German ones", async () => {
    deSite.shipTo = ["FR", "PL"];
    try {
      const de = await checkout({ postalCode: "10115", country: "DE" });
      expect(de.json().error).toBe("SHIPPING_COUNTRY_NOT_SUPPORTED");
      const fr = await checkout({ postalCode: "75001", country: "FR" });
      expect(fr.json().error).not.toBe("SHIPPING_COUNTRY_NOT_SUPPORTED");
      expect(fr.json().error).not.toBe("INVALID_POSTAL_CODE");
      const pl = await checkout({ postalCode: "00950", country: "PL" });
      expect(pl.json().error).not.toBe("INVALID_POSTAL_CODE");
      const badPl = await checkout({ postalCode: "750", country: "PL" });
      expect(badPl.json().error).toBe("INVALID_POSTAL_CODE");
    } finally {
      deSite.shipTo = [];
    }
  });
});

describe("Chambelli Germany storefront page", () => {
  it("is served with the carousel pointed at the public API", async () => {
    const res = await app.inject("/de");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-site="chambelli-de"');
    expect(res.body).toContain('src="https://api.example.com/widget.js"');
    expect(res.body).not.toContain("{{API_BASE}}");
  });
});

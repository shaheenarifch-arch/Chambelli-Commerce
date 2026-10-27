import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

const KEY = "test-admin-key-0123456789abcdef";
process.env.ADMIN_API_KEY = KEY;
process.env.REDIS_URL = "";

const db = {
  website: {
    findMany: vi.fn(async () => [{ id: "w1", name: "Tech" }]),
    findUnique: vi.fn(async () => null),
  },
};
vi.mock("@chambelli/database", () => ({
  db,
  EventType: { CAROUSEL_LOAD: "CAROUSEL_LOAD", IMPRESSION: "IMPRESSION", CLICK: "CLICK" },
  PaymentProvider: { STRIPE: "STRIPE", PAYPAL: "PAYPAL" },
  PaymentStatus: {},
  OrderStatus: {},
  CartStatus: {},
  ProductStatus: {},
  PromotionType: {},
  Prisma: {},
}));

const { buildApp } = await import("../apps/api/src/app.js");
const { isValidAdminKey } = await import("../apps/api/src/auth.js");

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ logger: false });
});
afterAll(() => app.close());

describe("admin authentication", () => {
  it("rejects missing and wrong keys", async () => {
    expect((await app.inject("/v1/admin/websites")).statusCode).toBe(401);
    const wrong = await app.inject({
      url: "/v1/admin/websites",
      headers: { "x-admin-key": "nope" },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("accepts the configured key", async () => {
    const res = await app.inject({ url: "/v1/admin/websites", headers: { "x-admin-key": KEY } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: "w1", name: "Tech" }]);
  });

  it("never treats an unset or short key as valid", () => {
    expect(isValidAdminKey(undefined, "")).toBe(false);
    expect(isValidAdminKey("", "")).toBe(false);
    expect(isValidAdminKey("short", "short")).toBe(false);
    expect(isValidAdminKey(KEY, KEY)).toBe(true);
  });
});

describe("public API", () => {
  it("reports health", async () => {
    expect((await app.inject("/health")).json()).toEqual({ status: "ok" });
  });

  it("serves the embeddable widget", async () => {
    const res = await app.inject("/widget.js");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
  });

  it("returns 404 for an unknown site", async () => {
    const res = await app.inject("/v1/carousels/nope/article-footer");
    expect(res.statusCode).toBe(404);
  });

  it("validates analytics events", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analytics",
      payload: { websiteSlug: "tech", eventType: "NOT_A_REAL_EVENT" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("VALIDATION_FAILED");
  });

  it("validates checkout input before touching anything", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/checkout", payload: { cartId: "x" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("payment webhooks", () => {
  it("refuse to run without provider configuration", async () => {
    const stripe = await app.inject({ method: "POST", url: "/v1/webhooks/stripe", payload: {} });
    expect(stripe.statusCode).toBe(503);
    const paypal = await app.inject({ method: "POST", url: "/v1/webhooks/paypal", payload: {} });
    expect(paypal.statusCode).toBe(503);
  });
});

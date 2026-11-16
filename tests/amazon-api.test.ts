import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

const KEY = "test-admin-key-0123456789abcdef";
process.env.ADMIN_API_KEY = KEY;
process.env.REDIS_URL = "";
process.env.CJ_ACCESS_TOKEN = "token";
process.env.CJ_API_BASE_URL = "https://cj.example.com";
process.env.AMAZON_US_CJ_LOGISTIC = "USPS+";

const sentOrder = {
  id: "33333333-3333-4333-8333-333333333333",
  marketplace: "US",
  amazonOrderId: "114-9",
  status: "SENT_TO_CJ",
  cjAttempts: 1,
  items: [],
};
const db = {
  amazonOrder: {
    findUniqueOrThrow: vi.fn(async () => sentOrder),
    update: vi.fn(),
  },
  amazonListing: { findMany: vi.fn(async () => []) },
  website: { findUniqueOrThrow: vi.fn(async () => ({ id: "s1", market: "US", currency: "USD" })) },
};
vi.mock("@chambelli/database", () => ({
  db,
  AmazonListingState: {
    LIVE: "LIVE",
    PROPOSED: "PROPOSED",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
  },
  AmazonOrderStatus: {
    NEW: "NEW",
    SENT_TO_CJ: "SENT_TO_CJ",
    CJ_FAILED: "CJ_FAILED",
    SHIPPED: "SHIPPED",
    CANCELLED: "CANCELLED",
  },
  EventType: {},
  PaymentProvider: {},
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

describe("Amazon control API", () => {
  it("needs the admin key", async () => {
    const res = await app.inject("/v1/admin/amazon/US/listings");
    expect(res.statusCode).toBe(401);
  });

  it("only knows US, CA and MX", async () => {
    const res = await app.inject({
      url: "/v1/admin/amazon/UK/listings",
      headers: { "x-admin-key": KEY },
    });
    expect(res.statusCode).toBe(400);
  });

  it("won't reorder from CJ without an explicit confirmation", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/amazon/orders/${sentOrder.id}/cj`,
      headers: { "x-admin-key": KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ALREADY_SENT_TO_CJ");
    expect(db.amazonOrder.update).not.toHaveBeenCalled();
  });

  it("won't approve website products until US shipping cost is set", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/sites/womenstyle/approve",
      headers: { "x-admin-key": KEY },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("SITE_SHIPPING_COST_NOT_SET");
  });
});

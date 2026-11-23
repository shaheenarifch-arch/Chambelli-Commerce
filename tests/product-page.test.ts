import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";

process.env.ADMIN_API_KEY = "test-admin-key-0123456789abcdef";
process.env.REDIS_URL = "";
process.env.PUBLIC_API_BASE_URL = "https://api.example.com/";
process.env.PAYPAL_CLIENT_ID = "client";
process.env.PAYPAL_CLIENT_SECRET = "secret";
process.env.PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";
process.env.STRIPE_SECRET_KEY = "";

const usSite = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "bostondaily",
  name: "Boston Daily",
  domain: "bostondaily.us",
  active: true,
  market: "US",
  currency: "USD",
};
const ukSite = { ...usSite, id: "u1", slug: "chambelli-uk", market: "UK", currency: "GBP" };
const variant = (id: string, name: string, currency: string, quantity = 5) => ({
  id,
  name,
  price: 24.99,
  compareAtPrice: 39.99,
  currency,
  quantity,
});
const product = {
  id: "p1",
  slug: "linen-dress",
  title: 'Linen <Summer> Dress "Blue"',
  description: "Light linen dress.",
  imageUrl: "https://cf.cjdropshipping.com/dress.jpg",
  category: "Dresses",
  status: "ACTIVE",
  variants: [variant("v1", "S", "USD"), variant("v2", "M", "USD", 0), variant("v3", "M", "GBP")],
  assignments: [{ website: usSite }],
};

const db = {
  product: {
    findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
      where.slug === product.slug ? product : null,
    ),
  },
  website: {
    findUnique: vi.fn(async ({ where }: { where: { slug?: string } }) =>
      where.slug === "chambelli-uk" ? ukSite : where.slug === usSite.slug ? usSite : null,
    ),
    findMany: vi.fn(async () => []),
  },
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

describe("product data API", () => {
  it("returns the product with options priced in the site's currency", async () => {
    const res = await app.inject("/v1/products/linen-dress?site=bostondaily&market=US");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.site).toMatchObject({ id: usSite.id, slug: "bostondaily", currency: "USD" });
    expect(body.variants).toEqual([
      expect.objectContaining({ id: "v1", name: "S", price: 24.99, inStock: true }),
      expect.objectContaining({ id: "v2", name: "M", inStock: false }),
    ]);
  });

  it("falls back to a site carrying the product when ?site= is missing or another market", async () => {
    const res = await app.inject("/v1/products/linen-dress?site=chambelli-uk&market=US");
    expect(res.json().site.slug).toBe("bostondaily");
  });

  it("404s for an unknown product", async () => {
    const res = await app.inject("/v1/products/nope");
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("PRODUCT_NOT_FOUND");
  });
});

describe("US product page", () => {
  it("is served with escaped product details, the page script and an image-friendly CSP", async () => {
    const res = await app.inject("/us/p/linen-dress?site=bostondaily");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Linen &lt;Summer&gt; Dress &quot;Blue&quot; · Chambelli");
    expect(res.body).toContain('src="https://api.example.com/product.js"');
    expect(res.body).toContain('data-market="US"');
    expect(res.body).not.toMatch(/\{\{[A-Z_]+\}\}/);
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("img-src 'self' https: data:");
    expect(csp).toContain("script-src 'self' https://api.example.com");
    // Stripe's card form loads its script and frames from Stripe.
    expect(csp).toContain("https://js.stripe.com");
    expect(csp).toContain("frame-src https://js.stripe.com https://hooks.stripe.com");
    expect(csp).toContain("connect-src 'self' https://api.example.com https://api.stripe.com");
  });

  it("404s for an unknown product", async () => {
    expect((await app.inject("/us/p/nope")).statusCode).toBe(404);
  });

  it("serves the checkout return page and the page script", async () => {
    expect((await app.inject("/us/checkout/return?token=X")).statusCode).toBe(200);
    const js = await app.inject("/product.js");
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toContain("javascript");
  });
});

describe("payment mode check", () => {
  it("reports PayPal sandbox and Stripe off", async () => {
    const res = await app.inject("/v1/payments/status");
    expect(res.json()).toEqual({ paypal: "sandbox", stripe: "off" });
  });
});

describe("product page extras", () => {
  it("offers related items, last-minute add-ons and both payment options", () => {
    const src = readFileSync(new URL("../apps/api/public/product.js", import.meta.url), "utf8");
    expect(src).toContain('id="related"');
    expect(src).toContain('id="addons"');
    expect(src).toContain('value="STRIPE"');
    expect(src).toContain('value="PAYPAL"');
    // Stepped checkout with an always-visible order summary that can change quantities.
    expect(src).toContain('id="summary"');
    expect(src).toContain('id="st-3"');
    expect(src).toContain("/items/${encodeURIComponent(line.variantId)}");
  });
});

describe("carousel widget", () => {
  it("links cards to the market's product page when a site gives no data-product-url", () => {
    const src = readFileSync(new URL("../apps/api/public/widget.js", import.meta.url), "utf8");
    expect(src).toContain("/${marketPath}/p/${encodeURIComponent(p.slug)}?site=");
  });
});

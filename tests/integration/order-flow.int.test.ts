/**
 * Runs against a real PostgreSQL database (CI provides one). It walks the full
 * money path: feed -> cart -> order -> payment confirmation -> stock.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db, ProductStatus, SupplierType, OrderStatus } from "@chambelli/database";
import { FeedService } from "@chambelli/feeds";
import { CartService } from "@chambelli/cart";
import { OrderService } from "@chambelli/orders";

const run = randomUUID().slice(0, 8);
let websiteId = "";
let variantId = "";
let addressId = "";

beforeAll(async () => {
  const site = await db.website.create({
    data: {
      name: `IT ${run}`,
      slug: `it-${run}`,
      domain: `it-${run}.example.com`,
      category: "tech",
      market: "US",
    },
  });
  websiteId = site.id;
  const product = await db.product.create({
    data: {
      sku: `IT-${run}`,
      slug: `it-product-${run}`,
      title: "Integration Test Product",
      category: "tech",
      tags: [],
      supplierType: SupplierType.OWNED,
      status: ProductStatus.ACTIVE,
      variants: {
        create: { sku: `IT-${run}-STD`, name: "Standard", cost: 10, price: 25, quantity: 5 },
      },
    },
    include: { variants: true },
  });
  variantId = product.variants[0].id;
  await db.productAssignment.create({
    data: { productId: product.id, websiteId, placement: "article-footer" },
  });
  const address = await db.address.create({
    data: {
      name: "Test Buyer",
      line1: "1 Main St",
      city: "Boston",
      postalCode: "02101",
      country: "US",
    },
  });
  addressId = address.id;
});

afterAll(async () => {
  await db.$disconnect();
});

async function placeOrder(quantity: number) {
  const carts = new CartService();
  const cart = await carts.getOrCreate(randomUUID(), websiteId, "USD");
  await carts.add(cart.id, variantId, quantity);
  return new OrderService().createFromCart({
    cartId: cart.id,
    websiteId,
    shippingAddressId: addressId,
    idempotencyKey: `it-${randomUUID()}`,
  });
}

describe("order flow (real database)", () => {
  it("serves the product in the site's carousel feed with its variant", async () => {
    const feed = await new FeedService().get(`it-${run}`, "article-footer");
    expect(feed?.products).toHaveLength(1);
    expect(feed?.products[0]).toMatchObject({ variantId, price: 25, position: 1 });
  });

  it("takes stock only once payment is confirmed, exactly once", async () => {
    const order = await placeOrder(2);
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(order.orderNumber).toMatch(/^CH-\d{8}-[0-9A-F]{8}$/);
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity).toBe(
      5,
    );

    const svc = new OrderService();
    expect((await svc.finalizePayment(order.id)).status).toBe("PAID");
    expect((await svc.finalizePayment(order.id)).status).toBe("ALREADY_FINALIZED");
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity).toBe(
      3,
    );
  });

  it("holds an order for review instead of overselling", async () => {
    const order = await placeOrder(3);
    // Someone else buys the last units before this shopper pays.
    await db.productVariant.update({ where: { id: variantId }, data: { quantity: 1 } });
    const res = await new OrderService().finalizePayment(order.id);
    expect(res.status).toBe("VALIDATION_REQUIRED");
    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved.status).toBe(OrderStatus.VALIDATION_REQUIRED);
    // The transaction rolled back, so no stock was taken.
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity).toBe(
      1,
    );
  });

  it("returns the same order for a retried checkout", async () => {
    const carts = new CartService();
    const cart = await carts.getOrCreate(randomUUID(), websiteId, "USD");
    await carts.add(cart.id, variantId, 1);
    const key = `it-${randomUUID()}`;
    const input = { cartId: cart.id, websiteId, shippingAddressId: addressId, idempotencyKey: key };
    const first = await new OrderService().createFromCart(input);
    const second = await new OrderService().createFromCart(input);
    expect(second.id).toBe(first.id);
  });
});

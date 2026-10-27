import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = {
  order: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  productVariant: { updateMany: vi.fn() },
  promotion: { findUnique: vi.fn(), updateMany: vi.fn() },
};
const db = {
  $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  order: { updateMany: vi.fn() },
};

vi.mock("@chambelli/database", () => ({
  db,
  Prisma: { Decimal: Number },
  CartStatus: { ACTIVE: "ACTIVE", CONVERTED: "CONVERTED" },
  OrderStatus: {
    PENDING_PAYMENT: "PENDING_PAYMENT",
    PAID: "PAID",
    VALIDATION_REQUIRED: "VALIDATION_REQUIRED",
  },
}));

const { OrderService, generateOrderNumber } = await import("../packages/orders/src/index.js");

const order = (over: object = {}) => ({
  id: "o1",
  status: "PENDING_PAYMENT",
  promotionCode: null,
  items: [
    { variantId: "v1", sku: "SKU-1", quantity: 2 },
    { variantId: "v2", sku: "SKU-2", quantity: 1 },
  ],
  ...over,
});

describe("generateOrderNumber", () => {
  it("is dated and unique", () => {
    const a = generateOrderNumber(new Date("2026-10-26T12:00:00Z"));
    expect(a).toMatch(/^CH-20261026-[0-9A-F]{8}$/);
    const many = new Set(Array.from({ length: 500 }, () => generateOrderNumber()));
    expect(many.size).toBe(500);
  });
});

describe("OrderService.finalizePayment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims the order, takes stock and counts the promo", async () => {
    tx.order.findUniqueOrThrow.mockResolvedValue(order({ promotionCode: "WELCOME10" }));
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.productVariant.updateMany.mockResolvedValue({ count: 1 });
    tx.promotion.findUnique.mockResolvedValue({ id: "promo1", maxUses: 100 });
    const res = await new OrderService().finalizePayment("o1");
    expect(res.status).toBe("PAID");
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: "o1", status: "PENDING_PAYMENT" },
      data: { status: "PAID" },
    });
    expect(tx.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: "v1", quantity: { gte: 2 } },
      data: { quantity: { decrement: 2 } },
    });
    expect(tx.promotion.updateMany).toHaveBeenCalledWith({
      where: { id: "promo1", OR: [{ maxUses: null }, { uses: { lt: 100 } }] },
      data: { uses: { increment: 1 } },
    });
  });

  it("holds the order instead of overselling when stock ran out", async () => {
    tx.order.findUniqueOrThrow.mockResolvedValue(order());
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.productVariant.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const res = await new OrderService().finalizePayment("o1");
    expect(res).toMatchObject({ status: "VALIDATION_REQUIRED", reason: "Out of stock: SKU-2" });
    expect(db.order.updateMany).toHaveBeenCalledWith({
      where: { id: "o1", status: "PENDING_PAYMENT" },
      data: { status: "VALIDATION_REQUIRED" },
    });
  });

  it("stops a concurrent second finalization before it touches stock", async () => {
    // Both read PENDING_PAYMENT, but only one can claim the order row.
    tx.order.findUniqueOrThrow.mockResolvedValue(order());
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    const res = await new OrderService().finalizePayment("o1");
    expect(res.status).toBe("ALREADY_FINALIZED");
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it("is idempotent when the provider sends the same event twice", async () => {
    tx.order.findUniqueOrThrow.mockResolvedValue(order({ status: "PAID" }));
    const res = await new OrderService().finalizePayment("o1");
    expect(res.status).toBe("ALREADY_FINALIZED");
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });
});

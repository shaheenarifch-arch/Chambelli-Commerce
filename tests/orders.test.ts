import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = {
  order: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
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

  it("takes stock, counts the promo and marks the order paid", async () => {
    tx.order.findUniqueOrThrow.mockResolvedValue(order({ promotionCode: "WELCOME10" }));
    tx.productVariant.updateMany.mockResolvedValue({ count: 1 });
    tx.promotion.findUnique.mockResolvedValue({ id: "promo1" });
    const res = await new OrderService().finalizePayment("o1");
    expect(res.status).toBe("PAID");
    expect(tx.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: "v1", quantity: { gte: 2 } },
      data: { quantity: { decrement: 2 } },
    });
    expect(tx.promotion.updateMany).toHaveBeenCalledOnce();
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "o1" }, data: { status: "PAID" } });
  });

  it("holds the order instead of overselling when stock ran out", async () => {
    tx.order.findUniqueOrThrow.mockResolvedValue(order());
    tx.productVariant.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const res = await new OrderService().finalizePayment("o1");
    expect(res).toMatchObject({ status: "VALIDATION_REQUIRED", reason: "Out of stock: SKU-2" });
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(db.order.updateMany).toHaveBeenCalledWith({
      where: { id: "o1", status: "PENDING_PAYMENT" },
      data: { status: "VALIDATION_REQUIRED" },
    });
  });

  it("is idempotent when the provider sends the same event twice", async () => {
    tx.order.findUniqueOrThrow.mockResolvedValue(order({ status: "PAID" }));
    const res = await new OrderService().finalizePayment("o1");
    expect(res.status).toBe("ALREADY_FINALIZED");
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });
});

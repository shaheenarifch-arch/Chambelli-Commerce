import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  order: { findUnique: vi.fn() },
  returnRequest: {
    create: vi.fn(async ({ data }) => ({ id: "r1", status: "REQUESTED", ...data })),
  },
};
vi.mock("@chambelli/database", () => ({
  db,
  OrderStatus: { DELIVERED: "DELIVERED", SHIPPED: "SHIPPED", PAID: "PAID" },
}));
const { ReturnService } = await import("../packages/returns/src/index.js");

const delivered = {
  id: "o1",
  status: "DELIVERED",
  customer: { email: "buyer@example.com" },
  items: [{ id: "i1", quantity: 2 }],
};

describe("ReturnService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts a valid request from the buyer", async () => {
    db.order.findUnique.mockResolvedValue(delivered);
    const r = await new ReturnService().request("o1", "Buyer@Example.com", "Broken", [
      { orderItemId: "i1", quantity: 2 },
    ]);
    expect(r.id).toBe("r1");
  });

  it("rejects someone who does not know the order email", async () => {
    db.order.findUnique.mockResolvedValue(delivered);
    await expect(
      new ReturnService().request("o1", "attacker@example.com", "x", [
        { orderItemId: "i1", quantity: 1 },
      ]),
    ).rejects.toThrow("ORDER_NOT_FOUND");
  });

  it("rejects items not on the order or quantities above what was bought", async () => {
    db.order.findUnique.mockResolvedValue(delivered);
    const svc = new ReturnService();
    await expect(
      svc.request("o1", "buyer@example.com", "x", [{ orderItemId: "other", quantity: 1 }]),
    ).rejects.toThrow("INVALID_RETURN_ITEMS");
    await expect(
      svc.request("o1", "buyer@example.com", "x", [
        { orderItemId: "i1", quantity: 2 },
        { orderItemId: "i1", quantity: 1 },
      ]),
    ).rejects.toThrow("INVALID_RETURN_ITEMS");
  });

  it("rejects returns before the order has shipped", async () => {
    db.order.findUnique.mockResolvedValue({ ...delivered, status: "PAID" });
    await expect(
      new ReturnService().request("o1", "buyer@example.com", "x", [
        { orderItemId: "i1", quantity: 1 },
      ]),
    ).rejects.toThrow("RETURN_NOT_AVAILABLE");
  });
});

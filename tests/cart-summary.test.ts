import { describe, it, expect, vi, beforeEach } from "vitest";

const cart = { id: "c1", status: "ACTIVE", currency: "USD", items: [] as unknown[] };
const items = new Map<
  string,
  { cartId: string; variantId: string; quantity: number; unitPrice: number }
>();
const variants: Record<string, unknown> = {
  v1: {
    id: "v1",
    name: "M",
    price: 24.99,
    quantity: 5,
    active: true,
    product: {
      status: "ACTIVE",
      title: "Linen dress",
      slug: "linen-dress",
      imageUrl: "https://cf.cjdropshipping.com/d.jpg",
    },
  },
};
const db = {
  cart: {
    findUniqueOrThrow: vi.fn(async () => ({ ...cart, items: [...items.values()] })),
  },
  cartItem: {
    findUnique: vi.fn(
      async ({ where }: { where: { cartId_variantId: { variantId: string } } }) =>
        items.get(where.cartId_variantId.variantId) ?? null,
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { cartId_variantId: { variantId: string } };
        data: { quantity: number };
      }) => {
        const it = items.get(where.cartId_variantId.variantId)!;
        it.quantity = data.quantity;
        return it;
      },
    ),
    delete: vi.fn(async ({ where }: { where: { cartId_variantId: { variantId: string } } }) => {
      items.delete(where.cartId_variantId.variantId);
    }),
  },
  productVariant: {
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => variants[where.id]),
    findMany: vi.fn(async () => Object.values(variants)),
  },
};
vi.mock("@chambelli/database", () => ({
  db,
  Prisma: {},
  CartStatus: { ACTIVE: "ACTIVE", CONVERTED: "CONVERTED" },
}));

const { CartService } = await import("@chambelli/cart");
const carts = new CartService();

beforeEach(() => {
  cart.status = "ACTIVE";
  items.clear();
  items.set("v1", { cartId: "c1", variantId: "v1", quantity: 2, unitPrice: 24.99 });
});

describe("checkout order summary", () => {
  it("lists each item with its title, option, photo and line total", async () => {
    const s = await carts.summary("c1");
    expect(s.subtotal).toBe(49.98);
    expect(s.lines).toEqual([
      expect.objectContaining({
        variantId: "v1",
        quantity: 2,
        lineTotal: 49.98,
        title: "Linen dress",
        option: "M",
        imageUrl: "https://cf.cjdropshipping.com/d.jpg",
        maxQuantity: 5,
      }),
    ]);
  });

  it("changes a quantity, and 0 removes the item", async () => {
    await carts.setQuantity("c1", "v1", 3);
    expect(items.get("v1")?.quantity).toBe(3);
    await carts.setQuantity("c1", "v1", 0);
    expect(items.has("v1")).toBe(false);
  });

  it("refuses more than the stock, a checked-out cart and a missing item", async () => {
    await expect(carts.setQuantity("c1", "v1", 6)).rejects.toThrow("INSUFFICIENT_STOCK");
    await expect(carts.setQuantity("c1", "v1", 21)).rejects.toThrow("INVALID_QUANTITY");
    await expect(carts.setQuantity("c1", "v9", 1)).rejects.toThrow("CART_ITEM_NOT_FOUND");
    cart.status = "CONVERTED";
    await expect(carts.setQuantity("c1", "v1", 1)).rejects.toThrow("CART_NOT_ORDERABLE");
  });
});

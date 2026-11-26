import { db, Prisma, CartStatus } from "@chambelli/database";
export class CartService {
  async getOrCreate(sessionId: string, websiteId: string, currency: string) {
    const existing = await db.cart.findFirst({
      where: { sessionId, websiteId, status: CartStatus.ACTIVE },
      include: { items: true },
    });
    return (
      existing ??
      db.cart.create({ data: { sessionId, websiteId, currency }, include: { items: true } })
    );
  }
  async add(cartId: string, variantId: string, quantity: number) {
    if (quantity < 1 || quantity > 20) throw new Error("INVALID_QUANTITY");
    const [cart, v, existing] = await Promise.all([
      db.cart.findUniqueOrThrow({ where: { id: cartId } }),
      db.productVariant.findUniqueOrThrow({ where: { id: variantId }, include: { product: true } }),
      db.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId } } }),
    ]);
    if (cart.status !== CartStatus.ACTIVE) throw new Error("CART_NOT_ORDERABLE");
    if (v.currency !== cart.currency) throw new Error("CURRENCY_MISMATCH");
    const total = (existing?.quantity ?? 0) + quantity;
    if (total > 20) throw new Error("INVALID_QUANTITY");
    if (!v.active || v.product.status !== "ACTIVE" || v.quantity < total)
      throw new Error("INSUFFICIENT_STOCK");
    return db.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId } },
      create: { cartId, variantId, quantity, unitPrice: v.price },
      update: { quantity: { increment: quantity }, unitPrice: v.price },
    });
  }
  /** Sets an item's quantity from the checkout's order summary (0 removes it). */
  async setQuantity(cartId: string, variantId: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 20)
      throw new Error("INVALID_QUANTITY");
    const [cart, existing] = await Promise.all([
      db.cart.findUniqueOrThrow({ where: { id: cartId } }),
      db.cartItem.findUnique({ where: { cartId_variantId: { cartId, variantId } } }),
    ]);
    if (cart.status !== CartStatus.ACTIVE) throw new Error("CART_NOT_ORDERABLE");
    if (!existing) throw new Error("CART_ITEM_NOT_FOUND");
    if (quantity === 0) return this.remove(cartId, variantId);
    const v = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      include: { product: true },
    });
    if (!v.active || v.product.status !== "ACTIVE" || v.quantity < quantity)
      throw new Error("INSUFFICIENT_STOCK");
    return db.cartItem.update({
      where: { cartId_variantId: { cartId, variantId } },
      data: { quantity, unitPrice: v.price },
    });
  }
  async remove(cartId: string, variantId: string) {
    return db.cartItem.delete({ where: { cartId_variantId: { cartId, variantId } } });
  }
  /**
   * The cart plus `lines`: each item with its product title, option name and photo, so the
   * checkout's order summary can show what is being bought.
   */
  async summary(cartId: string) {
    const cart = await db.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: { items: true },
    });
    const subtotal = cart.items.reduce((s, x) => s + Number(x.unitPrice) * x.quantity, 0);
    const variants = cart.items.length
      ? await db.productVariant.findMany({
          where: { id: { in: cart.items.map((i) => i.variantId) } },
          select: {
            id: true,
            name: true,
            quantity: true,
            product: { select: { title: true, slug: true, imageUrl: true } },
          },
        })
      : [];
    const byId = new Map(variants.map((v) => [v.id, v]));
    const lines = cart.items.map((i) => {
      const v = byId.get(i.variantId);
      const unitPrice = Number(i.unitPrice);
      return {
        variantId: i.variantId,
        quantity: i.quantity,
        unitPrice,
        lineTotal: Number((unitPrice * i.quantity).toFixed(2)),
        title: v?.product.title ?? "Item",
        option: v?.name ?? null,
        slug: v?.product.slug ?? null,
        imageUrl: v?.product.imageUrl ?? null,
        maxQuantity: Math.min(20, Math.max(0, v?.quantity ?? 0)),
      };
    });
    return { cart, subtotal: Number(subtotal.toFixed(2)), lines };
  }
}

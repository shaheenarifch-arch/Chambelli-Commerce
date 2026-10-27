import { db, Prisma, CartStatus, OrderStatus } from "@chambelli/database";
import { generateOrderNumber } from "./orderNumber.js";

export { generateOrderNumber };

export interface CreateOrderInput {
  cartId: string;
  websiteId: string;
  customerId?: string;
  shippingAddressId: string;
  idempotencyKey: string;
  promotionCode?: string;
  discount?: number;
  shipping?: number;
  tax?: number;
}

export type FinalizeResult =
  | { status: "PAID"; orderId: string }
  | { status: "ALREADY_FINALIZED"; orderId: string }
  | { status: "VALIDATION_REQUIRED"; orderId: string; reason: string };

export class OrderService {
  async createFromCart(input: CreateOrderInput) {
    const prior = await db.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { items: true },
    });
    if (prior) {
      // The same key from a different shopper or site must never hand back someone else's order.
      if (prior.websiteId !== input.websiteId || prior.customerId !== (input.customerId ?? null))
        throw new Error("IDEMPOTENCY_KEY_REUSED");
      return prior;
    }

    const cart = await db.cart.findUniqueOrThrow({
      where: { id: input.cartId },
      include: { items: true },
    });
    if (
      cart.status !== CartStatus.ACTIVE ||
      !cart.items.length ||
      cart.websiteId !== input.websiteId
    )
      throw new Error("CART_NOT_ORDERABLE");

    const ids = cart.items.map((x) => x.variantId);
    const variants = await db.productVariant.findMany({
      where: { id: { in: ids } },
      include: { product: { include: { supplierProducts: true } } },
    });
    const map = new Map(variants.map((v) => [v.id, v]));
    let subtotal = 0;
    const items = cart.items.map((i) => {
      const v = map.get(i.variantId);
      if (!v || !v.active || v.product.status !== "ACTIVE" || v.quantity < i.quantity)
        throw new Error("INVENTORY_CHANGED");
      if (v.currency !== cart.currency) throw new Error("CURRENCY_MISMATCH");
      // Charge today's price, not the price when the item was added to the cart.
      subtotal += Number(v.price) * i.quantity;
      return {
        productId: v.productId,
        variantId: v.id,
        title: v.product.title,
        sku: v.sku,
        quantity: i.quantity,
        unitPrice: v.price,
        unitCost: v.cost,
        supplierType: v.product.supplierType,
        supplierProductId: v.product.supplierProducts[0]?.supplierProductId,
      };
    });
    subtotal = Math.round(subtotal * 100) / 100;
    const discount = Math.min(input.discount ?? 0, subtotal);
    const shipping = input.shipping ?? 0;
    const tax = input.tax ?? 0;
    const total = Math.round((subtotal - discount + shipping + tax) * 100) / 100;

    return db.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          websiteId: input.websiteId,
          customerId: input.customerId,
          shippingAddressId: input.shippingAddressId,
          idempotencyKey: input.idempotencyKey,
          promotionCode: input.promotionCode,
          currency: cart.currency,
          subtotal: new Prisma.Decimal(subtotal),
          discountTotal: new Prisma.Decimal(discount),
          shippingTotal: new Prisma.Decimal(shipping),
          taxTotal: new Prisma.Decimal(tax),
          total: new Prisma.Decimal(total),
          items: { create: items },
        },
        include: { items: true },
      });
      await tx.cart.update({ where: { id: cart.id }, data: { status: CartStatus.CONVERTED } });
      return order;
    });
  }

  /**
   * Called only after a payment provider has confirmed the money (verified
   * webhook or server-side capture). Takes stock and counts the promo use in
   * one transaction. If stock ran out between checkout and payment, the order
   * is flagged VALIDATION_REQUIRED for a person to resolve rather than oversold.
   */
  async finalizePayment(orderId: string): Promise<FinalizeResult> {
    return db
      .$transaction(async (tx) => {
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { items: true },
        });
        if (order.status !== OrderStatus.PENDING_PAYMENT)
          return { status: "ALREADY_FINALIZED", orderId } as const;
        // Claim the order first. The row lock makes a concurrent finalization
        // (webhook and capture arriving together) see 0 rows and stop, so stock
        // and promo uses are never counted twice. A later throw undoes this too.
        const claimed = await tx.order.updateMany({
          where: { id: orderId, status: OrderStatus.PENDING_PAYMENT },
          data: { status: OrderStatus.PAID },
        });
        if (claimed.count !== 1) return { status: "ALREADY_FINALIZED", orderId } as const;

        const short: string[] = [];
        for (const item of order.items) {
          const res = await tx.productVariant.updateMany({
            where: { id: item.variantId, quantity: { gte: item.quantity } },
            data: { quantity: { decrement: item.quantity } },
          });
          if (res.count !== 1) short.push(item.sku);
        }
        if (short.length) {
          // Undo the stock already taken for this order, then hold it for review.
          throw new StockShortError(short);
        }

        if (order.promotionCode) {
          const promo = await tx.promotion.findUnique({ where: { code: order.promotionCode } });
          if (promo) {
            // Conditional, so the counter never passes maxUses under concurrency.
            await tx.promotion.updateMany({
              where: {
                id: promo.id,
                OR: [{ maxUses: null }, { uses: { lt: promo.maxUses ?? 0 } }],
              },
              data: { uses: { increment: 1 } },
            });
          }
        }
        return { status: "PAID", orderId } as const;
      })
      .catch(async (e: unknown) => {
        if (!(e instanceof StockShortError)) throw e;
        await db.order.updateMany({
          where: { id: orderId, status: OrderStatus.PENDING_PAYMENT },
          data: { status: OrderStatus.VALIDATION_REQUIRED },
        });
        return {
          status: "VALIDATION_REQUIRED",
          orderId,
          reason: `Out of stock: ${e.skus.join(", ")}`,
        } as const;
      });
  }
}

class StockShortError extends Error {
  constructor(public skus: string[]) {
    super("STOCK_SHORT");
  }
}

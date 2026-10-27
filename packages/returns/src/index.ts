import { db, OrderStatus } from "@chambelli/database";

const RETURNABLE: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.SHIPPED];

export class ReturnService {
  /**
   * Open a return request. The customer's email must match the order, and
   * every requested item must belong to the order with a quantity no larger
   * than was bought.
   */
  async request(
    orderId: string,
    customerEmail: string,
    reason: string,
    items: Array<{ orderItemId: string; quantity: number }>,
  ) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: true, customer: true },
    });
    if (!order || order.customer?.email.toLowerCase() !== customerEmail.trim().toLowerCase())
      throw new Error("ORDER_NOT_FOUND");
    if (!RETURNABLE.includes(order.status)) throw new Error("RETURN_NOT_AVAILABLE");

    const bought = new Map(order.items.map((i) => [i.id, i.quantity]));
    const requested = new Map<string, number>();
    for (const item of items) {
      requested.set(item.orderItemId, (requested.get(item.orderItemId) ?? 0) + item.quantity);
    }
    for (const [id, qty] of requested) {
      const max = bought.get(id);
      if (max === undefined || qty > max) throw new Error("INVALID_RETURN_ITEMS");
    }
    return db.returnRequest.create({ data: { orderId, reason, requestedItems: items } });
  }
}

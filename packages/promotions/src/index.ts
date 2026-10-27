import { db, PromotionType } from "@chambelli/database";
import { computeDiscount } from "./discount.js";

export { computeDiscount };

export class PromotionService {
  async apply(code: string, subtotal: number) {
    const p = await db.promotion.findUnique({ where: { code: code.trim().toUpperCase() } });
    const now = new Date();
    if (
      !p ||
      !p.active ||
      (p.startsAt && p.startsAt > now) ||
      (p.endsAt && p.endsAt < now) ||
      (p.maxUses !== null && p.uses >= p.maxUses) ||
      (p.minimumSubtotal && subtotal < Number(p.minimumSubtotal))
    )
      throw new Error("PROMOTION_NOT_ELIGIBLE");
    return {
      promotion: p,
      discount: computeDiscount(p.type, Number(p.value), subtotal),
      freeShipping: p.type === PromotionType.FREE_SHIPPING,
    };
  }
}

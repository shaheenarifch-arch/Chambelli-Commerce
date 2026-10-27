import { db, PromotionType } from "@chambelli/database";
export class PromotionService {
  async apply(code: string, subtotal: number) {
    const p = await db.promotion.findUnique({ where: { code: code.toUpperCase() } });
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
    let discount =
      p.type === PromotionType.PERCENT
        ? (subtotal * Number(p.value)) / 100
        : p.type === PromotionType.FIXED
          ? Number(p.value)
          : 0;
    return {
      promotion: p,
      discount: Math.min(subtotal, Number(discount.toFixed(2))),
      freeShipping: p.type === PromotionType.FREE_SHIPPING,
    };
  }
}

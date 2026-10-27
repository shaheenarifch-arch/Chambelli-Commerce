import { db, Prisma, SupplierType } from "@chambelli/database";
import { computePrice } from "./math.js";

export { computePrice };

export class PricingService {
  async calculate(cost: number, shipping: number, category: string, supplierType: SupplierType) {
    const rule = await db.pricingRule.findFirst({
      where: {
        active: true,
        AND: [
          { OR: [{ category: null }, { category }] },
          { OR: [{ supplierType: null }, { supplierType }] },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    const markup = Number(rule?.markupPercent ?? 35);
    const floor = Number(rule?.minimumMarginPercent ?? 15);
    return computePrice(cost, shipping, markup, floor);
  }
  async apply(variantId: string, price: number) {
    return db.productVariant.update({
      where: { id: variantId },
      data: { price: new Prisma.Decimal(price) },
    });
  }
}

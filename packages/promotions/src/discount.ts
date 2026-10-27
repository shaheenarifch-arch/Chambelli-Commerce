export type DiscountType = "PERCENT" | "FIXED" | "FREE_SHIPPING";

/** Pure discount math: never negative, never more than the subtotal, rounded to cents. */
export function computeDiscount(type: DiscountType, value: number, subtotal: number): number {
  if (subtotal <= 0 || value <= 0) return 0;
  const raw =
    type === "PERCENT" ? (subtotal * Math.min(value, 100)) / 100 : type === "FIXED" ? value : 0;
  return Math.min(subtotal, Math.round(raw * 100) / 100);
}

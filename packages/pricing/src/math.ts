/**
 * Pure pricing math, kept free of database access so it can be unit tested.
 * Price = the higher of (landed cost + markup) and (landed cost at the minimum margin),
 * rounded up to the next cent.
 */
export function computePrice(
  cost: number,
  shipping: number,
  markupPercent: number,
  minimumMarginPercent: number,
): number {
  if (!Number.isFinite(cost) || !Number.isFinite(shipping) || cost < 0 || shipping < 0) {
    throw new Error("INVALID_COST");
  }
  if (minimumMarginPercent < 0 || minimumMarginPercent >= 100) {
    throw new Error("INVALID_MARGIN_RULE");
  }
  const landed = cost + shipping;
  const withMarkup = landed * (1 + markupPercent / 100);
  const withFloor = landed / (1 - minimumMarginPercent / 100);
  return Math.ceil(Math.max(withMarkup, withFloor) * 100 - 1e-9) / 100;
}

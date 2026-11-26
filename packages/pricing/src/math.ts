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

/** Rounds a price up to a .99 ending (17.15 -> 17.99, 17.995 -> 18.99). */
export function ending99(p: number): number {
  const c = Math.floor(p) + 0.99;
  return Number((c + 1e-9 >= p ? c : Math.floor(p) + 1.99).toFixed(2));
}

/**
 * Price hold: what a CJ sync may do to a live price.
 * A sync never changes the price a shopper sees. When CJ's cost moves the price, the new price
 * waits as "pending" until it is accepted on the hub's Carousels page. A price that was turned
 * down ("declined") is not offered again until CJ's cost moves it to a different number.
 */
export function holdPriceChange(
  current: number,
  proposed: number,
  declined: number | null,
): { pendingPrice: number | null } {
  const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
  if (same(current, proposed)) return { pendingPrice: null };
  if (declined !== null && same(declined, proposed)) return { pendingPrice: null };
  return { pendingPrice: proposed };
}

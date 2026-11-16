/**
 * UK chapter: pure pricing, VAT and address rules for Chambelli UK sites.
 * No database access, so everything here is unit tested.
 */
import { computePrice } from "./math.js";

/** UK prices must clear this margin (before VAT) on the selling price, or the item is not sold. */
export const UK_MIN_MARGIN_PERCENT = 30;

/**
 * GBP selling price for a CJ item stocked in a UK (GB) warehouse.
 * CJ quotes in USD, so cost is converted with the rate you set (USD_TO_GBP_RATE).
 * Shipping is built into the price, so the site can say "free UK delivery".
 * UK shoppers must see prices with VAT included, so when vatPercent > 0 (you are
 * VAT-registered) it is added on top of the margin price. vatPercent 0 = not registered.
 * Returns null when the inputs are unusable, so the item is skipped rather than mispriced.
 */
export function ukPrice(
  costUsd: number,
  shippingGbp: number,
  usdToGbp: number,
  minMarginPercent = UK_MIN_MARGIN_PERCENT,
  vatPercent = 0,
): { cost: number; shipping: number; price: number; vat: number } | null {
  if (!(costUsd > 0) || !(usdToGbp > 0) || !(shippingGbp >= 0)) return null;
  if (!(vatPercent >= 0) || vatPercent > 30) return null;
  const cost = Math.round(costUsd * usdToGbp * 100) / 100;
  const net = computePrice(cost, shippingGbp, 0, minMarginPercent);
  const price = Math.ceil(net * (1 + vatPercent / 100) * 100 - 1e-9) / 100;
  return { cost, shipping: shippingGbp, price, vat: Math.round((price - net) * 100) / 100 };
}

/**
 * UK postcode, formatted "SW1A 1AA" (outward code, space, inward code).
 * Returns null when it is not a valid shape. BFPO and overseas territories are not accepted.
 */
export function normalizeUkPostcode(value: string): string | null {
  const v = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[ABD-HJLNP-UW-Z]{2}$/.test(v)) return null;
  return `${v.slice(0, -3)} ${v.slice(-3)}`;
}

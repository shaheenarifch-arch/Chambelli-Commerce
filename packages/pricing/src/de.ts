/**
 * Germany chapter: pure pricing and address rules for Chambelli Germany sites (EUR).
 * No database access, so everything here is unit tested. Help: docs/DE.md
 */
import { ukPrice } from "./uk.js";

/** German prices must clear this margin (before VAT) on the selling price, or the item is not sold. */
export const DE_MIN_MARGIN_PERCENT = 30;

/**
 * EUR selling price for a CJ item stocked in a German (DE) warehouse.
 * Same rule as the UK chapter: CJ cost (USD) × USD_TO_EUR_RATE + German delivery, priced for the
 * margin, then VAT on top when vatPercent > 0 (German shoppers must see VAT-inclusive prices;
 * keep 0 until you are registered for EU VAT, then 19). Returns null when inputs are unusable.
 */
export function dePrice(
  costUsd: number,
  shippingEur: number,
  usdToEur: number,
  minMarginPercent = DE_MIN_MARGIN_PERCENT,
  vatPercent = 0,
): { cost: number; shipping: number; price: number; vat: number } | null {
  return ukPrice(costUsd, shippingEur, usdToEur, minMarginPercent, vatPercent);
}

/** German postcode (Postleitzahl): exactly five digits, e.g. "10115". Returns null otherwise. */
export function normalizeDePostcode(value: string): string | null {
  const v = value.replace(/\s+/g, "").replace(/^D-?/i, "");
  return /^\d{5}$/.test(v) && v !== "00000" ? v : null;
}

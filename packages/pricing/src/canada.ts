/**
 * Canada chapter: pure pricing, tax and address rules for the Chambelli Canada storefront.
 * No database access, so everything here is unit tested.
 */
import { computePrice } from "./math.js";

/** Canadian prices must clear this margin on the selling price, or the item is not sold. */
export const CANADA_MIN_MARGIN_PERCENT = 30;

/**
 * CAD selling price for a CJ item stocked in a Canadian warehouse.
 * CJ quotes in USD, so cost is converted with the rate you set (USD_TO_CAD_RATE).
 * Shipping is built into the price, so the storefront can say "free shipping".
 * Returns null when the inputs are unusable, so the item is skipped rather than mispriced.
 */
export function canadaPrice(
  costUsd: number,
  shippingCad: number,
  usdToCad: number,
  minMarginPercent = CANADA_MIN_MARGIN_PERCENT,
): { cost: number; shipping: number; price: number } | null {
  if (!(costUsd > 0) || !(usdToCad > 0) || !(shippingCad >= 0)) return null;
  const cost = Math.round(costUsd * usdToCad * 100) / 100;
  const price = computePrice(cost, shippingCad, 0, minMarginPercent);
  return { cost, shipping: shippingCad, price };
}

/**
 * GST/HST by province and territory (CRA general rates, checked November 2026).
 * Provincial sales taxes (BC PST, MB RST, SK PST, QC QST) need separate provincial
 * registration and are not charged here.
 */
export const GST_HST_RATES: Record<string, number> = {
  AB: 5,
  BC: 5,
  MB: 5,
  NB: 15,
  NL: 15,
  NS: 14,
  NT: 5,
  NU: 5,
  ON: 13,
  PE: 15,
  QC: 5,
  SK: 5,
  YT: 5,
};

/** Full province and territory names, for help text and forms. */
export const CANADA_PROVINCES: Record<string, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

/** Accepts a two-letter code or a full name ("ON", "on", "Ontario"); returns the code or null. */
export function provinceCode(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  const upper = v.toUpperCase();
  if (CANADA_PROVINCES[upper]) return upper;
  const match = Object.entries(CANADA_PROVINCES).find(
    ([, name]) => name.toLowerCase() === v.toLowerCase(),
  );
  return match ? match[0] : null;
}

/** Canadian postal code, formatted "A1A 1A1". Returns null when it is not valid. */
export function normalizePostalCode(value: string): string | null {
  const v = value.replace(/\s+/g, "").toUpperCase();
  // First letter never D, F, I, O, Q, U, W or Z; other letters never D, F, I, O, Q or U.
  if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(v)) return null;
  return `${v.slice(0, 3)} ${v.slice(3)}`;
}

/**
 * GST/HST rate (percent) for an order shipped to a province. Charged only once you are
 * registered for GST/HST (CA_GST_HST_REGISTERED=true); before that it is 0, because an
 * unregistered seller must not collect it.
 */
export function canadaTaxRate(province: string, registered: boolean): number {
  const rate = GST_HST_RATES[province];
  if (rate === undefined) throw new Error("INVALID_PROVINCE");
  return registered ? rate : 0;
}

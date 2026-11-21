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

/**
 * Countries a Germany-chapter site delivers to: its own list, or Germany when the list is empty.
 * Only countries with a postcode rule below can be used.
 */
export function deShipTo(shipTo: string[] | null | undefined): string[] {
  const list = (shipTo ?? []).map((c) => c.toUpperCase()).filter((c) => c in EU_POSTCODES);
  return list.length ? list : ["DE"];
}

/** Postcode rules for the EU countries Germany-chapter sites deliver to. */
const EU_POSTCODES: Record<string, (v: string) => string | null> = {
  DE: (v) => normalizeDePostcode(v),
  // France: five digits, e.g. 75001.
  FR: (v) => {
    const c = v.replace(/\s+/g, "").replace(/^F-?/i, "");
    return /^\d{5}$/.test(c) && c !== "00000" ? c : null;
  },
  // Poland: two digits, dash, three digits, e.g. 00-950 (also accepted without the dash).
  PL: (v) => {
    const c = v.replace(/\s+/g, "").replace(/^PL-?/i, "");
    const m = /^(\d{2})-?(\d{3})$/.exec(c);
    return m ? `${m[1]}-${m[2]}` : null;
  },
};

/** Postcode for a delivery country, in that country's usual format; null when invalid. */
export function normalizeEuPostcode(country: string, value: string): string | null {
  const rule = EU_POSTCODES[country.toUpperCase()];
  return rule ? rule(value) : null;
}

/** German postcode (Postleitzahl): exactly five digits, e.g. "10115". Returns null otherwise. */
export function normalizeDePostcode(value: string): string | null {
  const v = value.replace(/\s+/g, "").replace(/^D-?/i, "");
  return /^\d{5}$/.test(v) && v !== "00000" ? v : null;
}

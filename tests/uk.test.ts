import { describe, it, expect } from "vitest";
import { ukPrice, normalizeUkPostcode } from "../packages/pricing/src/uk.js";

describe("ukPrice", () => {
  it("converts USD cost to GBP and prices for a 30% margin with UK shipping built in", () => {
    // 10 USD * 0.80 = 8.00 GBP, + 4.00 shipping = 12.00 landed / 0.70 = 17.1428 -> 17.15
    expect(ukPrice(10, 4, 0.8)).toEqual({ cost: 8, shipping: 4, price: 17.15, vat: 0 });
  });

  it("adds VAT on top of the margin price when registered", () => {
    const r = ukPrice(10, 4, 0.8, 30, 20)!;
    expect(r.price).toBe(20.58); // 17.15 * 1.2 = 20.58
    expect(r.vat).toBe(3.43);
    expect((r.price - r.vat - r.cost - r.shipping) / (r.price - r.vat)).toBeGreaterThanOrEqual(0.3);
  });

  it("skips items with no usable price, rate or VAT", () => {
    expect(ukPrice(0, 4, 0.8)).toBeNull();
    expect(ukPrice(10, 4, 0)).toBeNull();
    expect(ukPrice(10, -1, 0.8)).toBeNull();
    expect(ukPrice(10, 4, 0.8, 30, -5)).toBeNull();
  });
});

describe("normalizeUkPostcode", () => {
  it("formats valid postcodes", () => {
    expect(normalizeUkPostcode("sw1a1aa")).toBe("SW1A 1AA");
    expect(normalizeUkPostcode("M1 1AE")).toBe("M1 1AE");
    expect(normalizeUkPostcode(" cf10 1ep ")).toBe("CF10 1EP");
    expect(normalizeUkPostcode("B33 8TH")).toBe("B33 8TH");
  });
  it("rejects invalid ones", () => {
    expect(normalizeUkPostcode("12345")).toBeNull();
    expect(normalizeUkPostcode("M5V 2T6")).toBeNull();
    expect(normalizeUkPostcode("SW1A 1CI")).toBeNull();
  });
});

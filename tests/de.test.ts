import { describe, it, expect } from "vitest";
import {
  dePrice,
  normalizeDePostcode,
  normalizeEuPostcode,
  deShipTo,
} from "../packages/pricing/src/de.js";

describe("dePrice", () => {
  it("converts USD cost to EUR and prices for a 30% margin with German delivery built in", () => {
    // 10 USD * 0.92 = 9.20 EUR, + 4.00 delivery = 13.20 landed / 0.70 = 18.857 -> 18.86
    expect(dePrice(10, 4, 0.92)).toEqual({ cost: 9.2, shipping: 4, price: 18.86, vat: 0 });
  });

  it("adds German VAT (19%) on top of the margin price when registered", () => {
    const r = dePrice(10, 4, 0.92, 30, 19)!;
    expect(r.price).toBe(22.45); // 18.857 * 1.19 = 22.44.. rounded up
    expect((r.price - r.vat - r.cost - r.shipping) / (r.price - r.vat)).toBeGreaterThanOrEqual(0.3);
  });

  it("skips items with no usable price or rate", () => {
    expect(dePrice(0, 4, 0.92)).toBeNull();
    expect(dePrice(10, 4, 0)).toBeNull();
    expect(dePrice(10, -1, 0.92)).toBeNull();
  });
});

describe("normalizeDePostcode", () => {
  it("accepts five-digit postcodes", () => {
    expect(normalizeDePostcode("10115")).toBe("10115");
    expect(normalizeDePostcode(" 01067 ")).toBe("01067");
    expect(normalizeDePostcode("D-80331")).toBe("80331");
  });
  it("rejects invalid ones", () => {
    expect(normalizeDePostcode("1011")).toBeNull();
    expect(normalizeDePostcode("SW1A 1AA")).toBeNull();
    expect(normalizeDePostcode("00000")).toBeNull();
  });
});

describe("deShipTo / normalizeEuPostcode", () => {
  it("delivers to Germany unless the site lists other countries", () => {
    expect(deShipTo([])).toEqual(["DE"]);
    expect(deShipTo(null)).toEqual(["DE"]);
    expect(deShipTo(["fr", "PL"])).toEqual(["FR", "PL"]);
    expect(deShipTo(["XX"])).toEqual(["DE"]);
  });
  it("checks French and Polish postcodes", () => {
    expect(normalizeEuPostcode("FR", "75001")).toBe("75001");
    expect(normalizeEuPostcode("FR", "7500")).toBeNull();
    expect(normalizeEuPostcode("PL", "00950")).toBe("00-950");
    expect(normalizeEuPostcode("PL", "00-950")).toBe("00-950");
    expect(normalizeEuPostcode("PL", "7500")).toBeNull();
    expect(normalizeEuPostcode("ES", "28001")).toBeNull();
  });
});

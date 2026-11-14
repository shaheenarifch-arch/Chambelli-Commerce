import { describe, it, expect } from "vitest";
import {
  canadaPrice,
  canadaTaxRate,
  normalizePostalCode,
  provinceCode,
} from "../packages/pricing/src/canada.js";
import { countryStock } from "../packages/cj/src/index.js";

describe("canadaPrice", () => {
  it("converts USD cost to CAD and prices for a 30% margin with shipping built in", () => {
    // cost 10 USD * 1.40 = 14.00 CAD, + 6.00 shipping = 20.00 landed / 0.70 = 28.5714 -> 28.58
    expect(canadaPrice(10, 6, 1.4)).toEqual({ cost: 14, shipping: 6, price: 28.58 });
  });

  it("always leaves at least the minimum margin", () => {
    const r = canadaPrice(7.33, 9.5, 1.37)!;
    expect((r.price - r.cost - r.shipping) / r.price).toBeGreaterThanOrEqual(0.3);
  });

  it("skips items with no usable price or rate", () => {
    expect(canadaPrice(0, 5, 1.4)).toBeNull();
    expect(canadaPrice(10, 5, 0)).toBeNull();
    expect(canadaPrice(10, -1, 1.4)).toBeNull();
  });
});

describe("canadaTaxRate", () => {
  it("charges nothing until registered for GST/HST", () => {
    expect(canadaTaxRate("ON", false)).toBe(0);
  });
  it("uses the province's GST/HST rate once registered", () => {
    expect(canadaTaxRate("ON", true)).toBe(13);
    expect(canadaTaxRate("NS", true)).toBe(14);
    expect(canadaTaxRate("AB", true)).toBe(5);
  });
  it("rejects unknown provinces", () => {
    expect(() => canadaTaxRate("XX", true)).toThrow("INVALID_PROVINCE");
  });
});

describe("Canadian addresses", () => {
  it("accepts province codes and names", () => {
    expect(provinceCode("on")).toBe("ON");
    expect(provinceCode("British Columbia")).toBe("BC");
    expect(provinceCode("Texas")).toBeNull();
    expect(provinceCode(undefined)).toBeNull();
  });
  it("formats valid postal codes and rejects invalid ones", () => {
    expect(normalizePostalCode("m5v2t6")).toBe("M5V 2T6");
    expect(normalizePostalCode("K1A 0B1")).toBe("K1A 0B1");
    expect(normalizePostalCode("W5V 2T6")).toBeNull(); // W never starts a postal code
    expect(normalizePostalCode("01748")).toBeNull();
  });
});

describe("countryStock", () => {
  it("adds up only the stock held in the requested country", () => {
    const detail = {
      variants: [
        {
          inventories: [
            { countryCode: "CA", totalInventory: 12 },
            { countryCode: "US", totalInventory: 90 },
          ],
        },
        { inventories: [{ countryCode: "ca", totalInventory: "3" }] },
        { inventories: null },
      ],
    };
    expect(countryStock(detail, "CA")).toBe(15);
    expect(countryStock(detail, "GB")).toBe(0);
    expect(countryStock(undefined, "CA")).toBe(0);
  });
});

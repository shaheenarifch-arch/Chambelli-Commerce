import { describe, it, expect } from "vitest";
import { ending99, holdPriceChange } from "../packages/pricing/src/math.js";

describe("ending99", () => {
  it("rounds up to a .99 ending", () => {
    expect(ending99(17.15)).toBe(17.99);
    expect(ending99(17.99)).toBe(17.99);
    expect(ending99(17.995)).toBe(18.99);
    expect(ending99(18)).toBe(18.99);
  });
});

describe("holdPriceChange", () => {
  it("holds a new price for approval instead of changing the live one", () => {
    expect(holdPriceChange(17.99, 19.99, null)).toEqual({ pendingPrice: 19.99 });
    expect(holdPriceChange(17.99, 15.99, null)).toEqual({ pendingPrice: 15.99 });
  });

  it("has nothing to hold when the price is unchanged", () => {
    expect(holdPriceChange(17.99, 17.99, null)).toEqual({ pendingPrice: null });
  });

  it("does not offer a declined price again, but does offer a different one", () => {
    expect(holdPriceChange(17.99, 19.99, 19.99)).toEqual({ pendingPrice: null });
    expect(holdPriceChange(17.99, 20.99, 19.99)).toEqual({ pendingPrice: 20.99 });
  });
});

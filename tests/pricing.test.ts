import { describe, it, expect } from "vitest";
import { computePrice } from "../packages/pricing/src/math.js";
import { computeDiscount } from "../packages/promotions/src/discount.js";

describe("computePrice", () => {
  it("applies markup when it beats the margin floor", () => {
    // landed 10 -> markup 35% = 13.50, floor 15% = 11.77
    expect(computePrice(8, 2, 35, 15)).toBe(13.5);
  });

  it("uses the margin floor when markup is too thin", () => {
    // landed 10 -> markup 5% = 10.50, floor 30% = 14.2857 -> 14.29
    expect(computePrice(10, 0, 5, 30)).toBe(14.29);
  });

  it("rounds up to the next cent, never down", () => {
    expect(computePrice(9.99, 0, 33, 0)).toBe(13.29);
  });

  it("rejects margin rules that would divide by zero or go negative", () => {
    expect(() => computePrice(10, 0, 35, 100)).toThrow("INVALID_MARGIN_RULE");
    expect(() => computePrice(10, 0, 35, -1)).toThrow("INVALID_MARGIN_RULE");
  });

  it("rejects invalid costs", () => {
    expect(() => computePrice(-1, 0, 35, 15)).toThrow("INVALID_COST");
    expect(() => computePrice(Number.NaN, 0, 35, 15)).toThrow("INVALID_COST");
  });
});

describe("computeDiscount", () => {
  it("calculates percentage discounts", () => {
    expect(computeDiscount("PERCENT", 10, 59.99)).toBe(6);
  });

  it("caps percentage at 100%", () => {
    expect(computeDiscount("PERCENT", 150, 40)).toBe(40);
  });

  it("never discounts more than the subtotal", () => {
    expect(computeDiscount("FIXED", 25, 19.99)).toBe(19.99);
  });

  it("gives no money off for free shipping or empty carts", () => {
    expect(computeDiscount("FREE_SHIPPING", 10, 100)).toBe(0);
    expect(computeDiscount("FIXED", 10, 0)).toBe(0);
  });
});

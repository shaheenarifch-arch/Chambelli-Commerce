import { describe, it, expect, vi } from "vitest";

vi.mock("@chambelli/database", () => ({ db: {}, PaymentProvider: {}, PaymentStatus: {} }));
const { toMinor, currencyDigits } = await import("../packages/payments/src/index.js");

describe("currency minor units", () => {
  it("uses each currency's real decimal places", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("KWD")).toBe(3);
  });

  it("converts amounts without charging zero-decimal currencies 100x", () => {
    expect(toMinor(19.99, "USD")).toBe(1999);
    expect(toMinor("1500", "JPY")).toBe(1500);
    expect(toMinor(0.1 + 0.2, "USD")).toBe(30);
  });
});

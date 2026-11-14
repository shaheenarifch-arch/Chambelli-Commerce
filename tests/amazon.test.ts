import { describe, it, expect } from "vitest";
import {
  bulletsFromDescription,
  cjSkuFromSellerSku,
  cleanTitle,
  minimumPrice,
  newListingsFile,
  parseAllListingsReport,
  planListing,
  priceEnding99,
  priceQuantityFile,
  settingsFromEnv,
} from "../packages/amazon/src/rules.js";
import { cjOrderPayload, parseUnshippedOrdersReport } from "../packages/amazon/src/orders.js";
import { firstVariant, productInfo, warehouseTotals } from "../packages/cj/src/index.js";

const US = settingsFromEnv({ AMAZON_US_SHIPPING_COST: "5", AMAZON_US_CJ_LOGISTIC: "USPS+" }, "US");

describe("settings", () => {
  it("uses safe defaults per marketplace", () => {
    const ca = settingsFromEnv({}, "CA");
    expect(ca).toMatchObject({
      currency: "CAD",
      stockCountry: "CA",
      usdRate: null,
      shippingCost: null,
      marginPercent: 30,
      referralFeePercent: 15,
      maxQuantity: 10,
      stockBuffer: 2,
      cjLogistic: null,
    });
    expect(settingsFromEnv({}, "US").usdRate).toBe(1);
    expect(
      settingsFromEnv({ AMAZON_MX_USD_RATE: "18.2", AMAZON_MX_STOCK_COUNTRY: "us" }, "MX"),
    ).toMatchObject({ currency: "MXN", usdRate: 18.2, stockCountry: "US" });
  });
});

describe("All Listings report", () => {
  it("reads columns by name", () => {
    const text =
      "﻿item-name\tlisting-id\tseller-sku\tprice\tquantity\tasin1\tstatus\n" +
      "Willow Planter Basket\tX1\tLC-CJZS2593773\t42.38\t5\tB0HPJTHJLF\tActive\n" +
      "\t\t\t\t\t\t\n";
    expect(parseAllListingsReport(text)).toEqual([
      {
        sellerSku: "LC-CJZS2593773",
        asin: "B0HPJTHJLF",
        title: "Willow Planter Basket",
        price: 42.38,
        quantity: 5,
        status: "Active",
      },
    ]);
  });
  it("rejects files that are not listing reports", () => {
    expect(() => parseAllListingsReport("a\tb\n1\t2")).toThrow("REPORT_MISSING_SELLER_SKU");
  });
  it("maps Love$Care SKUs to CJ SKUs", () => {
    expect(cjSkuFromSellerSku("LC-CJZS2593773")).toBe("CJZS2593773");
    expect(cjSkuFromSellerSku("LC-CJST2541844-L")).toBe("CJST2541844-L");
    expect(cjSkuFromSellerSku("MY-OWN-SKU")).toBeNull();
  });
});

describe("margin and stock rules", () => {
  it("prices for the margin after Amazon's fee", () => {
    // (10 + 5) / (1 - 0.45) = 27.2727 -> 27.28
    expect(minimumPrice(10, 5, US)).toBe(27.28);
    expect(priceEnding99(27.28)).toBe(27.99);
    expect(priceEnding99(27.99)).toBe(27.99);
    expect(priceEnding99(28)).toBe(28.99);
  });
  it("sets quantity from CJ stock minus the buffer, capped", () => {
    expect(planListing({ price: 40, cjSku: "CJ1" }, { stock: 100, cost: 10 }, US)).toMatchObject({
      targetQuantity: 10,
      newPrice: null,
      alerts: [],
    });
    expect(planListing({ price: 40, cjSku: "CJ1" }, { stock: 4, cost: 10 }, US)).toMatchObject({
      targetQuantity: 2,
      alerts: ["LOW_STOCK"],
    });
    expect(planListing({ price: 40, cjSku: "CJ1" }, { stock: 2, cost: 10 }, US)).toMatchObject({
      targetQuantity: 0,
      alerts: ["OUT_OF_STOCK"],
    });
  });
  it("only ever raises a price that fell below the margin", () => {
    const p = planListing({ price: 20, cjSku: "CJ1" }, { stock: 50, cost: 10 }, US);
    expect(p.newPrice).toBe(27.99);
    expect(p.alerts).toEqual(["BELOW_MARGIN", "PRICE_RAISE_OVER_10_PERCENT"]);
    expect(
      planListing({ price: 99, cjSku: "CJ1" }, { stock: 50, cost: 10 }, US).newPrice,
    ).toBeNull();
  });
  it("never zeroes a listing it could not match", () => {
    expect(planListing({ price: 20, cjSku: "CJX" }, { stock: null, cost: null }, US)).toEqual({
      targetQuantity: null,
      minPrice: null,
      newPrice: null,
      alerts: ["CJ_SKU_NOT_FOUND"],
    });
    expect(planListing({ price: 20, cjSku: null }, { stock: 9, cost: 1 }, US).alerts).toEqual([
      "CJ_SKU_MISSING",
    ]);
  });
  it("converts CJ's USD cost for other marketplaces and flags missing settings", () => {
    const ca = settingsFromEnv({ AMAZON_CA_USD_RATE: "1.4", AMAZON_CA_SHIPPING_COST: "7" }, "CA");
    // 10 USD -> 14 CAD; (14 + 7) / 0.55 = 38.1818 -> 38.19
    expect(planListing({ price: 50, cjSku: "CJ1" }, { stock: 20, cost: 10 }, ca).minPrice).toBe(
      38.19,
    );
    expect(
      planListing({ price: 50, cjSku: "CJ1" }, { stock: 20, cost: 10 }, settingsFromEnv({}, "CA"))
        .alerts,
    ).toEqual(["FX_RATE_NOT_SET"]);
  });
});

describe("upload files", () => {
  it("builds the price and quantity file with only real changes", () => {
    const f = priceQuantityFile([
      { sellerSku: "LC-A", newPrice: 27.99, quantity: 5 },
      { sellerSku: "LC-B", newPrice: null, quantity: 0 },
      { sellerSku: "LC-C", newPrice: null, quantity: null },
    ]).split("\n");
    expect(f[0]).toBe(
      "sku\tprice\tminimum-seller-allowed-price\tmaximum-seller-allowed-price\tquantity\thandling-time\tfulfillment-channel",
    );
    expect(f[1]).toBe("LC-A\t27.99\t\t\t5\t\t");
    expect(f[2]).toBe("LC-B\t\t\t\t0\t\t");
    expect(f).toHaveLength(4);
  });
  it("builds approved listing rows without tabs leaking into cells", () => {
    const f = newListingsFile([
      {
        sellerSku: "LC-A",
        title: "Rack\twith tab",
        price: 19.99,
        quantity: 8,
        bullets: ["One"],
        description: "Line\nbreak",
        imageUrls: ["https://x/1.jpg"],
      },
    ]);
    const row = f.split("\n")[1].split("\t");
    expect(row).toHaveLength(14);
    expect(row[1]).toBe("Rack with tab");
    expect(row[9]).toBe("Line break");
    expect(row[10]).toBe("https://x/1.jpg");
  });
  it("turns CJ descriptions into bullets and trims titles", () => {
    expect(
      bulletsFromDescription(
        "<p>Strong steel frame holds 20 lbs.</p><p>Easy install, no tools needed.</p><p>Hi</p>",
      ),
    ).toEqual(["Strong steel frame holds 20 lbs.", "Easy install, no tools needed."]);
    expect(cleanTitle("word ".repeat(60)).length).toBeLessThanOrEqual(200);
  });
});

describe("orders", () => {
  const report =
    "order-id\tpurchase-date\tsku\tproduct-name\tquantity-purchased\tquantity-to-ship\trecipient-name\tship-address-1\tship-address-2\tship-city\tship-state\tship-postal-code\tship-country\tship-phone-number\n" +
    "114-1\t2026-11-13T10:00:00Z\tLC-CJJT2539381\tHOME Metal Sign\t1\t1\tJane Doe\t1 Main St\tApt 2\tBoston\tMA\t02101\tUS\t555-0100\n" +
    "114-1\t2026-11-13T10:00:00Z\tLC-CJZS2593773\tPlanter\t2\t2\tJane Doe\t1 Main St\tApt 2\tBoston\tMA\t02101\tUS\t555-0100\n";
  it("groups report rows into orders", () => {
    const [o] = parseUnshippedOrdersReport(report);
    expect(o.amazonOrderId).toBe("114-1");
    expect(o.items).toEqual([
      { sellerSku: "LC-CJJT2539381", cjSku: "CJJT2539381", title: "HOME Metal Sign", quantity: 1 },
      { sellerSku: "LC-CJZS2593773", cjSku: "CJZS2593773", title: "Planter", quantity: 2 },
    ]);
    expect(o).toMatchObject({
      city: "Boston",
      region: "MA",
      postalCode: "02101",
      country: "US",
      addressLine2: "Apt 2",
    });
  });
  it("builds an unpaid CJ order and numbers reorders", () => {
    const [o] = parseUnshippedOrdersReport(report);
    const first = cjOrderPayload({ ...o, attempt: 0 }, US);
    expect(first).toMatchObject({
      orderNumber: "114-1",
      payType: 3,
      fromCountryCode: "US",
      logisticName: "USPS+",
      shippingCountry: "United States",
      products: [
        { sku: "CJJT2539381", quantity: 1 },
        { sku: "CJZS2593773", quantity: 2 },
      ],
    });
    expect(cjOrderPayload({ ...o, attempt: 2 }, US).orderNumber).toBe("114-1-R2");
  });
  it("refuses to order without a shipping method or CJ SKU", () => {
    const [o] = parseUnshippedOrdersReport(report);
    expect(() => cjOrderPayload({ ...o, attempt: 0 }, settingsFromEnv({}, "US"))).toThrow(
      "CJ_LOGISTIC_NOT_SET",
    );
    expect(() =>
      cjOrderPayload({ ...o, items: [{ ...o.items[0], cjSku: null }], attempt: 0 }, US),
    ).toThrow("CJ_SKU_MISSING");
  });
});

describe("CJ responses", () => {
  it("adds up stock per warehouse country", () => {
    expect(
      warehouseTotals([
        { countryCode: "US", totalInventoryNum: 12 },
        { countryCode: "us", totalInventoryNum: "3" },
        { countryCode: "CN", totalInventoryNum: 900 },
        { countryCode: "CA", totalInventoryNum: 0 },
      ]),
    ).toEqual({ US: 15, CN: 900 });
    expect(warehouseTotals(null)).toEqual({});
  });
  it("reads variant cost and product photos", () => {
    expect(
      firstVariant([
        {
          vid: "v1",
          pid: "p1",
          variantSku: "CJ1",
          variantNameEn: "Black",
          variantSellPrice: "7.50",
        },
      ]),
    ).toEqual({ vid: "v1", pid: "p1", sku: "CJ1", name: "Black", image: null, cost: 7.5 });
    expect(firstVariant([])).toBeNull();
    expect(
      productInfo({
        productNameEn: "Rack",
        productImage: "https://a/1.jpg",
        productImageSet: '["https://a/1.jpg","https://a/2.jpg","not-a-url"]',
      }),
    ).toEqual({ title: "Rack", description: null, images: ["https://a/1.jpg", "https://a/2.jpg"] });
  });
});

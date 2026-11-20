import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  CJConnector,
  parseCJPrice,
  inventoryByPidTotals,
  topCategoryIndex,
  normalizeCategory,
  sitesForCategory,
  titleFitsSite,
  applyOnlyOnSite,
  type SiteMap,
} from "../packages/cj/src/index.js";

describe("parseCJPrice", () => {
  it("handles numbers, numeric strings and ranges", () => {
    expect(parseCJPrice(4.5)).toBe(4.5);
    expect(parseCJPrice("7.25")).toBe(7.25);
    expect(parseCJPrice("1.20-3.40")).toBe(1.2);
    expect(parseCJPrice("3.40 -- 1.20")).toBe(1.2);
  });

  it("returns 0 for missing or unusable values", () => {
    expect(parseCJPrice(undefined)).toBe(0);
    expect(parseCJPrice("")).toBe(0);
    expect(parseCJPrice("N/A")).toBe(0);
    expect(parseCJPrice(Number.NaN)).toBe(0);
  });
});

describe("CJConnector", () => {
  afterEach(() => vi.unstubAllGlobals());

  const page = (n: number) => ({
    result: true,
    data: { list: Array.from({ length: n }, (_, i) => ({ pid: `p${i}`, sellPrice: "2.00" })) },
  });

  it("sends the CJ-Access-Token header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(page(1))));
    vi.stubGlobal("fetch", fetchMock);
    await new CJConnector("tok", "https://cj.test").listProducts(1, 10);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "CJ-Access-Token": "tok" });
  });

  it("pages until a short page and stops", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page(2))))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(2))))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(1))));
    vi.stubGlobal("fetch", fetchMock);
    const pages: number[] = [];
    for await (const items of new CJConnector("tok", "https://cj.test").allProducts(2, 10, 0)) {
      pages.push(items.length);
    }
    expect(pages).toEqual([2, 2, 1]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("respects the page cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(page(2)))),
    );
    let count = 0;
    for await (const _ of new CJConnector("tok", "https://cj.test").allProducts(2, 3, 0)) count++;
    expect(count).toBe(3);
  });

  it("surfaces CJ API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ result: false, message: "token expired" }))),
    );
    await expect(new CJConnector("tok", "https://cj.test").listProducts()).rejects.toThrow(
      "CJ_API_ERROR: token expired",
    );
  });
});

describe("CJ categories and site map", () => {
  afterEach(() => vi.unstubAllGlobals());

  const tree = [
    {
      categoryFirstId: "f1",
      categoryFirstName: "Pet Supplies",
      categoryFirstList: [
        {
          categorySecondId: "s1",
          categorySecondName: "Dogs",
          categorySecondList: [{ categoryId: "t1", categoryName: "Dog Toys" }],
        },
      ],
    },
    { categoryFirstName: "Home, Garden & Furniture", categoryFirstList: [] },
  ];

  it("maps every category level to its top-level name", () => {
    const index = topCategoryIndex(tree);
    expect(index.get("f1")).toBe("Pet Supplies");
    expect(index.get("s1")).toBe("Pet Supplies");
    expect(index.get("t1")).toBe("Pet Supplies");
  });

  it("matches category names loosely", () => {
    expect(normalizeCategory("Home, Garden & Furniture")).toBe(
      normalizeCategory("home garden and furniture"),
    );
  });

  it("finds the sites for a category", () => {
    const map = JSON.parse(readFileSync("config/cj-site-map.json", "utf8")) as SiteMap;
    expect(sitesForCategory(map, "Pet Supplies").map((s) => s.domain)).toEqual([
      "petscoolstuff.trade",
    ]);
    expect(sitesForCategory(map, "Unknown")).toEqual([]);
  });

  it("every mapped site is complete and unique", () => {
    const map = JSON.parse(readFileSync("config/cj-site-map.json", "utf8")) as SiteMap;
    const slugs = map.sites.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of map.sites) {
      expect(s.cjCategories.length).toBeGreaterThan(0);
      expect(s.terms.length).toBeGreaterThan(0);
    }
  });

  it("sends search filters to CJ", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result: true, data: { list: [] } })));
    vi.stubGlobal("fetch", fetchMock);
    await new CJConnector("tok", "https://cj.test").listProducts(1, 50, {
      productNameEn: "dog toy",
      countryCode: "US",
    });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("productNameEn")).toBe("dog toy");
    expect(url.searchParams.get("countryCode")).toBe("US");
  });
});

describe("website carousel site map", async () => {
  const { readFileSync } = await import("node:fs");
  const { titleFitsSite } = await import("../packages/cj/src/index.js");
  const map = JSON.parse(
    readFileSync(new URL("../config/cj-site-map.json", import.meta.url), "utf8"),
  );

  it("covers the 29 chosen sites with 20 to 50 products each", () => {
    expect(map.productsPerSite).toBe(50);
    expect(map.minProductsPerSite).toBe(20);
    const domains = map.sites.map((s: { domain: string }) => s.domain);
    expect(domains).toHaveLength(29);
    expect(new Set(map.sites.map((s: { slug: string }) => s.slug)).size).toBe(29);
    for (const d of [
      "shopdress.us",
      "firearmsafety.us",
      "medicalsupplie.com",
      "bostondaily.us",
      "ticktes.online",
    ])
      expect(domains).toContain(d);
  });

  it("keeps firearmsafety.us to safes and vaults", () => {
    const site = map.sites.find((s: { slug: string }) => s.slug === "firearmsafety");
    expect(titleFitsSite("Biometric Gun Safe for Pistols, Quick Access", site)).toBe(true);
    expect(titleFitsSite("Fireproof Document Lock Box with Key", site)).toBe(true);
    expect(titleFitsSite("Tactical Leather Holster", site)).toBe(false);
    expect(titleFitsSite("LED Desk Lamp", site)).toBe(false);
  });

  it("keeps medicalsupplie.com to everyday non-prescription supplies", () => {
    const site = map.sites.find((s: { slug: string }) => s.slug === "medicalsupplie");
    expect(titleFitsSite("Adjustable Knee Brace Support", site)).toBe(true);
    expect(titleFitsSite("Weekly Pill Organizer 7 Day", site)).toBe(true);
    expect(titleFitsSite("Disposable Syringe Needle Set", site)).toBe(false);
    expect(titleFitsSite("Makeup Brush Set", site)).toBe(false);
  });

  it("sells the 4 UK sites from UK stock with title rules and UK plugs only", () => {
    const uk = map.sites.filter((s: { market?: string }) => s.market === "UK");
    expect(uk.map((s: { domain: string }) => s.domain).sort()).toEqual([
      "buybeststore.com",
      "buybeststores.uk",
      "ezpass.uk",
      "jewllery.store",
    ]);
    for (const s of uk) expect(s.titleMatch.length).toBeGreaterThan(0);
    const ez = map.sites.find((s: { slug: string }) => s.slug === "ezpassuk");
    expect(ez.titleExclude).toContain("us plug");
  });

  it("matches whole words only, so 'safe' no longer pulls in 'safety' items", () => {
    const fire = map.sites.find((s: { slug: string }) => s.slug === "firearmsafety");
    expect(titleFitsSite("Stainless Steel Stock Pot with Glass Lid, Dishwasher Safe", fire)).toBe(
      false,
    );
    expect(titleFitsSite("Full over Full Bunk Bed with Ladder And Safety Guard", fire)).toBe(false);
    expect(titleFitsSite("12FT Trampoline Spring Cover Safety Pad", fire)).toBe(false);
    expect(titleFitsSite("Yellow 4-Wheel Kids Pedal Go Kart", fire)).toBe(false);
    expect(titleFitsSite("Steel Wall Safes for Home, 2 Pack", fire)).toBe(true);
    expect(titleFitsSite("Electronic Shooting Earmuffs", fire)).toBe(true);

    const med = map.sites.find((s: { slug: string }) => s.slug === "medicalsupplie");
    expect(titleFitsSite("Memory Foam Pillow", med)).toBe(false); // "pill" is not "pillow"
    expect(titleFitsSite("Gold Charm Bracelet", med)).toBe(false); // "brace" is not "bracelet"
    expect(titleFitsSite("Shower Chair with Back for Seniors", med)).toBe(true);

    const biz = map.sites.find((s: { slug: string }) => s.slug === "businessbuy");
    expect(titleFitsSite("Round Iron Sign, Doorbell Malfunction Warning Plaque", biz)).toBe(false);
    expect(titleFitsSite("Thermal Laminator A4 for Office", biz)).toBe(true);
    expect(titleFitsSite("Bank Bill Counters with Counterfeit Detection", biz)).toBe(true);
  });

  it("lets sites without title rules take anything in their categories", () => {
    expect(titleFitsSite("Anything", {})).toBe(true);
  });
});

describe("CJConnector.myProducts (Added Products)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads CJ's My Product List and shapes rows like catalog items", async () => {
    const body = {
      result: true,
      data: {
        pageNumber: 1,
        content: [
          {
            productId: "2506210138111608900",
            sku: "CJYD240735801AZ",
            nameEn: "Simulation Marine Life Tiger Shark Model Children's Toy",
            bigImage: "https://cf.cjdropshipping.com/shark.jpg",
            sellPrice: "2.51",
          },
        ],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    vi.stubGlobal("fetch", fetchMock);
    const items = await new CJConnector("tok", "https://cj.test").myProducts(1, 100);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://cj.test/product/myProduct/query?pageNum=1&pageSize=100",
    );
    expect(items).toEqual([
      {
        pid: "2506210138111608900",
        productSku: "CJYD240735801AZ",
        productNameEn: "Simulation Marine Life Tiger Shark Model Children's Toy",
        productImage: "https://cf.cjdropshipping.com/shark.jpg",
        sellPrice: "2.51",
      },
    ]);
  });

  it("finds a product's category id", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ result: true, data: { categoryId: "cat-9" } })),
        ),
    );
    expect(await new CJConnector("tok", "https://cj.test").categoryIdByPid("p1")).toBe("cat-9");
  });
});

describe("inventoryByPidTotals", () => {
  it("reads product-level US stock even when variant inventories only list CN", () => {
    const data = {
      inventories: [
        { areaId: 2, areaEn: "US Warehouse", countryCode: "US", totalInventoryNum: 264 },
        { areaId: 1, areaEn: "China Warehouse", countryCode: "CN", totalInventoryNum: "900" },
      ],
      variantInventories: [{ vid: "1", inventory: [{ countryCode: "CN", totalInventory: 10044 }] }],
    };
    expect(inventoryByPidTotals(data)).toEqual({ US: 264, CN: 900 });
  });

  it("returns nothing for empty or unexpected data", () => {
    expect(inventoryByPidTotals(null)).toEqual({});
    expect(inventoryByPidTotals({ inventories: "x" })).toEqual({});
  });
});

describe("onlyOnSite", () => {
  it("keeps shorts on shopdress only", () => {
    const map = applyOnlyOnSite({
      productsPerSite: 50,
      onlyOnSite: { shorts: "shopdress" },
      sites: [
        { slug: "shopdress", name: "S", domain: "shopdress.us", cjCategories: [], terms: [] },
        { slug: "womenstyle", name: "W", domain: "womenstyle.win", cjCategories: [], terms: [] },
      ],
    });
    const [shop, women] = map.sites;
    expect(titleFitsSite("Women's Denim Shorts", shop!)).toBe(true);
    expect(titleFitsSite("Women's Denim Shorts", women!)).toBe(false);
    expect(titleFitsSite("Short Sleeve Blouse", women!)).toBe(true);
  });
});

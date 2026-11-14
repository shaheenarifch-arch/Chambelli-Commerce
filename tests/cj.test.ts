import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  CJConnector,
  parseCJPrice,
  topCategoryIndex,
  normalizeCategory,
  sitesForCategory,
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

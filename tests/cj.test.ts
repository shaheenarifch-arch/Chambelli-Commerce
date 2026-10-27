import { describe, it, expect, vi, afterEach } from "vitest";
import { CJConnector, parseCJPrice } from "../packages/cj/src/index.js";

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

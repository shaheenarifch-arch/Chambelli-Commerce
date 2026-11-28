import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

process.env.REDIS_URL = "";

const rows: unknown[] = [];
const db = {
  productAssignment: { findMany: vi.fn(async () => rows) },
};
vi.mock("@chambelli/database", () => ({
  db,
  ProductStatus: { ACTIVE: "ACTIVE" },
}));

const { resolveDepartment, getCatalog, clearCatalogCache, loadDepartmentMap } =
  await import("../apps/api/src/catalog.js");

const deptMap = JSON.parse(readFileSync("config/departments.json", "utf8"));
const siteMap = JSON.parse(readFileSync("config/cj-site-map.json", "utf8"));

describe("config/departments.json", () => {
  it("has 14 departments with unique slugs and a valid fallback", () => {
    const slugs = deptMap.departments.map((d: { slug: string }) => d.slug);
    expect(slugs).toHaveLength(14);
    expect(new Set(slugs).size).toBe(14);
    expect(slugs).toContain(deptMap.fallback);
  });

  it("lists only real carousel sites, each in at most one department", () => {
    const known = new Set(siteMap.sites.map((s: { slug: string }) => s.slug));
    const seen = new Set<string>();
    for (const d of deptMap.departments)
      for (const s of d.sites) {
        expect(known.has(s), `unknown site ${s}`).toBe(true);
        expect(seen.has(s), `site ${s} in two departments`).toBe(false);
        seen.add(s);
      }
  });
});

describe("resolveDepartment", () => {
  it("uses the carousel site first", () => {
    expect(resolveDepartment(["medicalsupplie"], "Home, Garden & Furniture", deptMap)).toBe(
      "health",
    );
    expect(resolveDepartment(["shopdress"], "", deptMap)).toBe("fashion");
    expect(resolveDepartment(["lensloop"], "", deptMap)).toBe("jewelry-eyewear");
  });

  it("falls back to the CJ category for mixed sites", () => {
    expect(resolveDepartment(["coupondepots"], "Pet Supplies", deptMap)).toBe("pets");
    expect(resolveDepartment(["bostondaily"], "consumer electronics", deptMap)).toBe(
      "electronics-office",
    );
  });

  it("uses the fallback when nothing matches", () => {
    expect(resolveDepartment(["coupondepots"], "uncategorized", deptMap)).toBe("home");
  });
});

const row = (
  productId: string,
  site: string,
  opts: { category?: string; price?: number; score?: number; title?: string } = {},
) => ({
  productId,
  website: { slug: site },
  product: {
    id: productId,
    slug: `slug-${productId}`,
    title: opts.title ?? `Product ${productId}`,
    imageUrl: `https://cf.cjdropshipping.com/${productId}.jpg`,
    category: opts.category ?? "uncategorized",
    variants: [{ price: opts.price ?? 19.99, compareAtPrice: null, currency: "USD" }],
    score: { finalScore: opts.score ?? 0 },
  },
});

describe("getCatalog", () => {
  beforeEach(() => {
    clearCatalogCache();
    rows.length = 0;
    db.productAssignment.findMany.mockClear();
  });

  it("lists each product once, in its department, best score first", async () => {
    rows.push(
      row("a", "coupondepots", { category: "Pet Supplies", score: 1 }),
      row("b", "medicalsupplie", { score: 5 }),
      row("a", "petscoolstuff", { category: "Pet Supplies", score: 1 }),
      row("c", "drivezone", { score: 3, title: "Car Seat Cover (TikTok, temu pick-up)" }),
    );
    const cat = await getCatalog("us");
    expect(cat.currency).toBe("USD");
    expect(cat.productPath).toBe("us");
    expect(cat.products.map((p) => p.id)).toEqual(["b", "c", "a"]);
    const a = cat.products.find((p) => p.id === "a")!;
    expect(a.department).toBe("pets");
    // Linked through the site that matches its department.
    expect(a.site).toBe("petscoolstuff");
    // Supplier shipping notes never reach shoppers.
    expect(cat.products.find((p) => p.id === "c")!.title).not.toMatch(/temu/i);
    expect(cat.departments.find((d) => d.slug === "health")!.count).toBe(1);
    expect(cat.departments.find((d) => d.slug === "fashion")!.count).toBe(0);
    expect(cat.departments).toHaveLength(14);
  });

  it("asks the database for the market's own currency and market", async () => {
    await getCatalog("eu");
    const arg = db.productAssignment.findMany.mock.calls[0]![0] as {
      where: { website: { market: string }; product: { variants: { some: { currency: string } } } };
    };
    expect(arg.where.website.market).toBe("DE");
    expect(arg.where.product.variants.some.currency).toBe("EUR");
  });

  it("caches a market for a while", async () => {
    await getCatalog("uk");
    await getCatalog("uk");
    expect(db.productAssignment.findMany).toHaveBeenCalledTimes(1);
  });

  it("loads the department map from config", async () => {
    const m = await loadDepartmentMap();
    expect(m.departments.length).toBe(14);
  });
});

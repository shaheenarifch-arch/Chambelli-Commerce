#!/usr/bin/env node
/**
 * CJ shortlists (unbranded, US warehouse stock only).
 *
 * 1. ShopDress: searches each department, writes shortlist/cj-shortlist.csv.
 * 2. Websites: for each site in config/cj-site-map.json, searches its terms, keeps
 *    products inside the site's CJ categories and writes shortlist/sites/<slug>.csv.
 * Nothing is imported or published: these are lists to approve.
 *
 * Help: https://developers.cjdropshipping.com/en/api/api2/api/product.html
 * Site map guide: docs/CJ-SITE-MAP.md
 * Run: CJ_API_KEY=... node scripts/cj-shortlist.mjs
 * Only one part: SHORTLIST=shopdress or SHORTLIST=sites
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.CJ_API_BASE_URL || "https://developers.cjdropshipping.com/api2.0/v1";
const KEY = process.env.CJ_API_KEY;
const ONLY = process.env.SHORTLIST || "all"; // all | shopdress | sites
if (!KEY) {
  console.error(
    "CJ_API_KEY is not set. Add it as a repository secret (Settings > Secrets > Actions).",
  );
  process.exit(1);
}

// Department mix from the ShopDress plan (~500 products). [department, search terms, target count]
const PLAN = [
  [
    "Women",
    ["women dress", "women top", "women jeans", "women leggings", "women sweater", "women jacket"],
    125,
  ],
  ["Men", ["men t-shirt", "men polo", "men hoodie", "men jeans", "men joggers", "men jacket"], 100],
  ["Shoes", ["sneakers", "running shoes", "women sandals", "boots", "casual shoes"], 75],
  ["Kids", ["girls dress", "boys t-shirt", "kids pajamas", "baby romper", "kids jacket"], 50],
  ["Active", ["gym shirt", "yoga leggings", "sports shorts", "tracksuit"], 50],
  [
    "Bags & Accessories",
    ["handbag", "crossbody bag", "backpack", "wallet", "baseball cap", "sunglasses"],
    40,
  ],
  ["Basics", ["socks", "underwear", "undershirt", "sleepwear"], 25],
  ["Home", ["bath towel", "throw pillow cover", "storage basket"], 20],
  ["Seasonal", ["christmas sweater", "winter scarf", "gloves"], 15],
];

// Branded names on CJ are very likely counterfeit: never shortlist them.
const BRANDS =
  /\b(nike|adidas|puma|under ?armou?r|levi'?s|calvin klein|tommy|hilfiger|champion|new balance|reebok|skechers|columbia|nautica|dockers|guess|steve madden|gucci|prada|chanel|louis vuitton|lv|dior|versace|fendi|balenciaga|ralph lauren|polo ralph|michael kors|coach|kate spade|vans|converse|jordan|yeezy|north face|lululemon|crocs|ugg|disney|marvel|hello kitty)\b/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const price = (v) => {
  const nums =
    String(v ?? "")
      .match(/\d+(?:\.\d+)?/g)
      ?.map(Number)
      .filter((n) => n > 0) ?? [];
  return nums.length ? Math.min(...nums) : 0;
};
const toNinetyNine = (n) => Math.max(0.99, Math.ceil(n) - 0.01);

async function call(path, init = {}) {
  const r = await fetch(`${BASE}${path}`, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.result === false) throw new Error(`${path}: ${body.message || r.status}`);
  return body.data;
}

const auth = await call("/authentication/getAccessToken", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ apiKey: KEY }),
});
const token = auth?.accessToken;
if (!token) throw new Error("CJ did not return an access token");
const headers = { "CJ-Access-Token": token };

function writeCsv(path, rows) {
  const cols = Object.keys(rows[0] || { department: "" });
  const csv = [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, csv + "\n");
}

if (ONLY !== "sites") {
  const seen = new Set();
  const rows = [];
  for (const [dept, terms, target] of PLAN) {
    const perTerm = Math.ceil(target / terms.length);
    let deptCount = 0;
    for (const term of terms) {
      if (deptCount >= target) break;
      await sleep(1100); // CJ allows about one request per second
      const q = new URLSearchParams({
        productNameEn: term,
        countryCode: "US",
        pageNum: "1",
        pageSize: "50",
      });
      let list = [];
      try {
        const data = await call(`/product/list?${q}`, { headers });
        list = Array.isArray(data) ? data : (data?.list ?? []);
      } catch (e) {
        console.warn(`skip "${term}": ${e.message}`);
        continue;
      }
      let taken = 0;
      for (const p of list) {
        if (taken >= perTerm || deptCount >= target) break;
        const name = String(p.productNameEn || "").trim();
        const cost = price(p.sellPrice);
        if (!p.pid || seen.has(p.pid) || !name || !p.productImage || !cost || BRANDS.test(name))
          continue;
        seen.add(p.pid);
        taken++;
        deptCount++;
        rows.push({
          department: dept,
          search_term: term,
          cj_pid: p.pid,
          cj_sku: p.productSku || "",
          name,
          image: p.productImage,
          cj_cost_usd: cost.toFixed(2),
          // Starting price at about 2x product cost; shipping is added at review.
          suggested_price_usd: toNinetyNine(cost * 2).toFixed(2),
          price_band: cost * 2 < 25 ? "Under $25" : cost * 2 < 50 ? "Under $50" : "$50+",
          cj_link: `https://cjdropshipping.com/product/-p-${p.pid}.html`,
        });
      }
    }
    console.log(`${dept}: ${deptCount}/${target}`);
  }

  writeCsv("shortlist/cj-shortlist.csv", rows);
  console.log(`Wrote ${rows.length} products to shortlist/cj-shortlist.csv`);
}

// ---- Website shortlists from config/cj-site-map.json ----
const norm = (n) =>
  String(n)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

if (ONLY !== "shopdress") {
  const map = JSON.parse(readFileSync(new URL("../config/cj-site-map.json", import.meta.url)));
  // Every CJ category id (any level) -> its top-level name, e.g. "Pet Supplies".
  const topOf = new Map();
  try {
    await sleep(1100);
    for (const f of (await call("/product/getCategory", { headers })) ?? []) {
      const top = norm(f.categoryFirstName || "");
      if (f.categoryFirstId) topOf.set(f.categoryFirstId, top);
      for (const s2 of f.categoryFirstList ?? []) {
        if (s2.categorySecondId) topOf.set(s2.categorySecondId, top);
        for (const s3 of s2.categorySecondList ?? [])
          if (s3.categoryId) topOf.set(s3.categoryId, top);
      }
    }
  } catch (e) {
    console.warn(`CJ categories not loaded, keeping all search results: ${e.message}`);
  }

  const summary = [];
  for (const site of map.sites) {
    const want = new Set(site.cjCategories.map(norm));
    const target = map.productsPerSite;
    const perTerm = Math.ceil(target / site.terms.length);
    const picked = new Set();
    const siteRows = [];
    for (const term of site.terms) {
      if (siteRows.length >= target) break;
      await sleep(1100);
      const q = new URLSearchParams({
        productNameEn: term,
        countryCode: "US",
        pageNum: "1",
        pageSize: "50",
      });
      let list = [];
      try {
        const data = await call(`/product/list?${q}`, { headers });
        list = Array.isArray(data) ? data : (data?.list ?? []);
      } catch (e) {
        console.warn(`${site.domain} skip "${term}": ${e.message}`);
        continue;
      }
      let taken = 0;
      for (const p of list) {
        if (taken >= perTerm || siteRows.length >= target) break;
        const name = String(p.productNameEn || "").trim();
        const cost = price(p.sellPrice);
        if (!p.pid || picked.has(p.pid) || !name || !p.productImage || !cost || BRANDS.test(name))
          continue;
        const top = topOf.get(p.categoryId);
        // Keep only products inside the site's CJ categories (unknown category: keep for review).
        if (top && !want.has(top)) continue;
        picked.add(p.pid);
        taken++;
        siteRows.push({
          site: site.domain,
          cj_category: p.categoryName || "",
          search_term: term,
          cj_pid: p.pid,
          cj_sku: p.productSku || "",
          name,
          image: p.productImage,
          cj_cost_usd: cost.toFixed(2),
          suggested_price_usd: toNinetyNine(cost * 2).toFixed(2),
          cj_link: `https://cjdropshipping.com/product/-p-${p.pid}.html`,
        });
      }
    }
    writeCsv(`shortlist/sites/${site.slug}.csv`, siteRows);
    summary.push(`${site.domain}: ${siteRows.length}/${target}`);
    console.log(summary.at(-1));
  }
  writeFileSync("shortlist/sites/SUMMARY.txt", summary.join("\n") + "\n");
}

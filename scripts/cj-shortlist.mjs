#!/usr/bin/env node
/**
 * ShopDress CJ shortlist (unbranded value fashion, US warehouse stock only).
 *
 * Reads CJ_API_KEY from the environment, gets a CJ access token, searches each
 * department and writes shortlist/cj-shortlist.csv for review in the back office.
 * Nothing is imported into the store: this is a list to approve.
 *
 * Help: https://developers.cjdropshipping.com/en/api/api2/api/product.html
 * Run: CJ_API_KEY=... node scripts/cj-shortlist.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.CJ_API_BASE_URL || "https://developers.cjdropshipping.com/api2.0/v1";
const KEY = process.env.CJ_API_KEY;
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

const cols = Object.keys(rows[0] || { department: "" });
const csv = [
  cols.join(","),
  ...rows.map((r) => cols.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(",")),
].join("\n");
mkdirSync("shortlist", { recursive: true });
writeFileSync("shortlist/cj-shortlist.csv", csv + "\n");
console.log(`Wrote ${rows.length} products to shortlist/cj-shortlist.csv`);

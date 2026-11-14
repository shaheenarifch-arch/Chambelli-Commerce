import { db, Prisma, AmazonListingState, AmazonOrderStatus } from "@chambelli/database";
import type { CJConnector } from "@chambelli/cj";
import {
  bulletsFromDescription,
  cjSkuFromSellerSku,
  cleanTitle,
  newListingsFile,
  parseAllListingsReport,
  planListing,
  priceEnding99,
  priceQuantityFile,
  type AmazonSettings,
  type Marketplace,
} from "./rules.js";
import { cjOrderPayload, parseUnshippedOrdersReport, type OrderItem } from "./orders.js";

export * from "./rules.js";
export * from "./orders.js";

const CJ_DELAY_MS = 1100; // CJ allows one request per second
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const n = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : Number(v));

export class AmazonService {
  constructor(private delayMs = CJ_DELAY_MS) {}

  /** Loads Seller Central's All Listings report. Keeps any CJ SKU you corrected by hand. */
  async importListings(marketplace: Marketplace, text: string) {
    const rows = parseAllListingsReport(text);
    let created = 0;
    for (const r of rows) {
      const where = { marketplace_sellerSku: { marketplace, sellerSku: r.sellerSku } };
      const existing = await db.amazonListing.findUnique({ where });
      const data = {
        asin: r.asin,
        title: r.title,
        amazonStatus: r.status,
        price: r.price,
        quantity: r.quantity,
        state: AmazonListingState.LIVE,
      };
      if (existing) await db.amazonListing.update({ where, data });
      else {
        await db.amazonListing.create({
          data: { ...data, marketplace, sellerSku: r.sellerSku, cjSku: cjSkuFromSellerSku(r.sellerSku) },
        });
        created++;
      }
    }
    return { imported: rows.length, created, updated: rows.length - created };
  }

  /** Checks CJ stock and cost for live listings and records what Amazon should show. */
  async checkListings(cj: CJConnector, s: AmazonSettings, onlyId?: string) {
    const listings = await db.amazonListing.findMany({
      where: { marketplace: s.marketplace, state: AmazonListingState.LIVE, ...(onlyId ? { id: onlyId } : {}) },
    });
    let checked = 0;
    let failed = 0;
    for (const l of listings) {
      try {
        let stock: number | null = null;
        let cost: number | null = null;
        if (l.cjSku) {
          if (checked > 0) await sleep(this.delayMs);
          const totals = await cj.stockBySku(l.cjSku);
          await sleep(this.delayMs);
          const variant = await cj.variantBySku(l.cjSku);
          cost = variant?.cost ?? null;
          stock = Object.keys(totals).length || variant ? (totals[s.stockCountry] ?? 0) : null;
        }
        const plan = planListing({ price: n(l.price), cjSku: l.cjSku }, { stock, cost }, s);
        await db.amazonListing.update({
          where: { id: l.id },
          data: {
            cjStock: stock,
            cjCost: cost,
            minPrice: plan.minPrice,
            targetQuantity: plan.targetQuantity,
            alerts: plan.alerts,
            lastCheckedAt: new Date(),
          },
        });
        checked++;
      } catch {
        failed++;
      }
    }
    return { checked, failed };
  }

  /**
   * Drafts new listings from CJ SKUs that have stock in the marketplace's warehouse country.
   * They wait as PROPOSED until you approve them.
   */
  async propose(cj: CJConnector, s: AmazonSettings, cjSkus: string[]) {
    const results: Array<{ cjSku: string; ok: boolean; reason?: string; id?: string }> = [];
    for (const [i, raw] of cjSkus.entries()) {
      const cjSku = raw.trim().toUpperCase();
      if (!cjSku) continue;
      if (i > 0) await sleep(this.delayMs);
      try {
        const variant = await cj.variantBySku(cjSku);
        if (!variant) {
          results.push({ cjSku, ok: false, reason: "CJ_SKU_NOT_FOUND" });
          continue;
        }
        await sleep(this.delayMs);
        const stock = (await cj.stockBySku(cjSku))[s.stockCountry] ?? 0;
        if (stock <= s.stockBuffer) {
          results.push({ cjSku, ok: false, reason: "NOT_ENOUGH_STOCK" });
          continue;
        }
        await sleep(this.delayMs);
        const product = variant.pid ? await cj.productByPid(variant.pid) : null;
        const plan = planListing({ price: null, cjSku }, { stock, cost: variant.cost }, s);
        const title = cleanTitle(
          product?.title ? `${product.title}${variant.name ? `, ${variant.name}` : ""}` : variant.name,
        );
        const images = product?.images.length ? product.images : variant.image ? [variant.image] : [];
        const sellerSku = `LC-${cjSku}`;
        const data = {
          title,
          state: AmazonListingState.PROPOSED,
          cjSku,
          bullets: bulletsFromDescription(product?.description),
          description: product?.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000) ?? null,
          imageUrls: images,
          cjCost: variant.cost,
          cjStock: stock,
          minPrice: plan.minPrice,
          price: plan.newPrice,
          targetQuantity: plan.targetQuantity,
          alerts: plan.alerts,
          lastCheckedAt: new Date(),
        };
        const existing = await db.amazonListing.findUnique({
          where: { marketplace_sellerSku: { marketplace: s.marketplace, sellerSku } },
        });
        if (existing && existing.state === AmazonListingState.LIVE) {
          results.push({ cjSku, ok: false, reason: "ALREADY_LISTED" });
          continue;
        }
        const saved = await db.amazonListing.upsert({
          where: { marketplace_sellerSku: { marketplace: s.marketplace, sellerSku } },
          create: { ...data, marketplace: s.marketplace, sellerSku },
          update: data,
        });
        results.push({ cjSku, ok: true, id: saved.id });
      } catch (e) {
        results.push({ cjSku, ok: false, reason: e instanceof Error ? e.message : "unknown" });
      }
    }
    return results;
  }

  /** Approve or reject a proposed listing. Live listings cannot be changed this way. */
  async setProposalState(id: string, state: "APPROVED" | "REJECTED" | "PROPOSED") {
    const l = await db.amazonListing.findUniqueOrThrow({ where: { id } });
    if (l.state === AmazonListingState.LIVE) throw new Error("LISTING_ALREADY_LIVE");
    return db.amazonListing.update({ where: { id }, data: { state } });
  }

  /** Edit a listing: CJ SKU match, or the title, bullets and price of a proposal. */
  async editListing(
    id: string,
    patch: { cjSku?: string | null; title?: string; bullets?: string[]; price?: number | null },
  ) {
    const l = await db.amazonListing.findUniqueOrThrow({ where: { id } });
    const data: Prisma.AmazonListingUpdateInput = {};
    if (patch.cjSku !== undefined) data.cjSku = patch.cjSku ? patch.cjSku.trim().toUpperCase() : null;
    if (l.state !== AmazonListingState.LIVE) {
      if (patch.title !== undefined) data.title = cleanTitle(patch.title);
      if (patch.bullets !== undefined) data.bullets = patch.bullets.slice(0, 5);
      if (patch.price !== undefined) {
        const min = n(l.minPrice);
        if (patch.price !== null && min !== null && patch.price < min) throw new Error("PRICE_BELOW_MARGIN");
        data.price = patch.price;
      }
    }
    return db.amazonListing.update({ where: { id }, data });
  }

  /** Seller Central price-and-quantity upload for live listings. */
  async priceQuantityFile(marketplace: Marketplace) {
    const rows = await db.amazonListing.findMany({
      where: { marketplace, state: AmazonListingState.LIVE },
      orderBy: { sellerSku: "asc" },
    });
    return priceQuantityFile(
      rows.map((r) => {
        const price = n(r.price);
        const min = n(r.minPrice);
        const newPrice = min !== null && (price === null || price < min) ? priceEnding99(min) : null;
        const quantity = r.targetQuantity !== null && r.targetQuantity !== r.quantity ? r.targetQuantity : null;
        return { sellerSku: r.sellerSku, newPrice, quantity };
      }),
    );
  }

  /** Approved new listings, ready for Amazon's category upload template. */
  async newListingsFile(marketplace: Marketplace) {
    const rows = await db.amazonListing.findMany({
      where: { marketplace, state: AmazonListingState.APPROVED },
      orderBy: { createdAt: "asc" },
    });
    return newListingsFile(
      rows.map((r) => ({
        sellerSku: r.sellerSku,
        title: r.title,
        price: n(r.price),
        quantity: r.targetQuantity,
        bullets: r.bullets,
        description: r.description,
        imageUrls: r.imageUrls,
      })),
    );
  }

  /** Loads Seller Central's Unshipped Orders report. Orders already sent to CJ are left alone. */
  async importOrders(marketplace: Marketplace, text: string) {
    const orders = parseUnshippedOrdersReport(text);
    let created = 0;
    for (const o of orders) {
      const existing = await db.amazonOrder.findUnique({ where: { amazonOrderId: o.amazonOrderId } });
      const data = { ...o, items: o.items as unknown as Prisma.InputJsonValue, marketplace };
      if (!existing) {
        await db.amazonOrder.create({ data });
        created++;
      } else if (existing.status === AmazonOrderStatus.NEW || existing.status === AmazonOrderStatus.CJ_FAILED) {
        await db.amazonOrder.update({ where: { id: existing.id }, data });
      }
    }
    return { imported: orders.length, created };
  }

  /**
   * Places (or re-places) the CJ order for an Amazon order. A re-order of an order already
   * sent to CJ needs force=true, so a double click never buys twice.
   */
  async orderFromCj(cj: CJConnector, s: AmazonSettings, orderId: string, force = false) {
    const o = await db.amazonOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (o.marketplace !== s.marketplace) throw new Error("WRONG_MARKETPLACE");
    if (o.status === AmazonOrderStatus.CANCELLED || o.status === AmazonOrderStatus.SHIPPED)
      throw new Error("ORDER_CLOSED");
    if (o.status === AmazonOrderStatus.SENT_TO_CJ && !force) throw new Error("ALREADY_SENT_TO_CJ");
    const items = o.items as unknown as OrderItem[];
    // Use the CJ SKU you corrected on the listing, when there is one.
    const listings = await db.amazonListing.findMany({
      where: { marketplace: o.marketplace, sellerSku: { in: items.map((i) => i.sellerSku) } },
    });
    const fixed = items.map((i) => ({
      ...i,
      cjSku: listings.find((l) => l.sellerSku === i.sellerSku)?.cjSku ?? i.cjSku,
    }));
    const attempt = o.cjAttempts;
    let payload;
    try {
      payload = cjOrderPayload({ ...o, items: fixed, attempt }, s);
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      await db.amazonOrder.update({ where: { id: o.id }, data: { status: AmazonOrderStatus.CJ_FAILED, cjError: message } });
      throw e;
    }
    try {
      const out = await cj.createOrder(payload);
      return db.amazonOrder.update({
        where: { id: o.id },
        data: {
          status: AmazonOrderStatus.SENT_TO_CJ,
          cjAttempts: attempt + 1,
          cjOrderId: out.orderId,
          cjOrderStatus: out.orderStatus,
          cjAmountUsd: out.amountUsd,
          cjError: null,
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      await db.amazonOrder.update({
        where: { id: o.id },
        data: { status: AmazonOrderStatus.CJ_FAILED, cjAttempts: attempt + 1, cjError: message.slice(0, 500) },
      });
      throw new Error("CJ_ORDER_FAILED");
    }
  }

  /** Mark an order shipped (with tracking) or cancelled. */
  async setOrderStatus(id: string, status: "SHIPPED" | "CANCELLED" | "NEW", tracking?: string) {
    return db.amazonOrder.update({
      where: { id },
      data: { status, ...(tracking !== undefined ? { tracking: tracking.trim() || null } : {}) },
    });
  }

  /** Counts per marketplace for the dashboard header. */
  async overview() {
    const [listings, orders] = await Promise.all([
      db.amazonListing.groupBy({ by: ["marketplace", "state"], _count: true }),
      db.amazonOrder.groupBy({ by: ["marketplace", "status"], _count: true }),
    ]);
    const alerts = await db.amazonListing.groupBy({
      by: ["marketplace"],
      where: { state: AmazonListingState.LIVE, NOT: { alerts: { isEmpty: true } } },
      _count: true,
    });
    return { listings, orders, alerts };
  }
}


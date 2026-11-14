/**
 * Pure rules for Amazon orders: reading Seller Central's unshipped-orders report and
 * building the CJ order. No database or network access.
 */
import { cjSkuFromSellerSku, type AmazonSettings } from "./rules.js";

export interface OrderItem {
  sellerSku: string;
  cjSku: string | null;
  title: string;
  quantity: number;
}

export interface ReportOrder {
  amazonOrderId: string;
  purchaseDate: Date | null;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string | null;
  items: OrderItem[];
}

/**
 * Parses Seller Central's "Unshipped Orders" report (Orders > Order Reports), tab-separated.
 * One row per item; rows with the same order-id are joined into one order.
 */
export function parseUnshippedOrdersReport(text: string): ReportOrder[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const idx = (n: string) => header.indexOf(n);
  if (idx("order-id") < 0 || idx("sku") < 0) throw new Error("REPORT_NOT_UNSHIPPED_ORDERS");
  const orders = new Map<string, ReportOrder>();
  for (const line of lines.slice(1)) {
    const c = line.split("\t");
    const get = (n: string) => (idx(n) >= 0 ? (c[idx(n)] ?? "").trim() : "");
    const id = get("order-id");
    const sku = get("sku");
    if (!id || !sku) continue;
    const qty = Number(get("quantity-to-ship") || get("quantity-purchased") || "0");
    if (!(qty > 0)) continue;
    let o = orders.get(id);
    if (!o) {
      const date = get("purchase-date");
      o = {
        amazonOrderId: id,
        purchaseDate: date && !Number.isNaN(Date.parse(date)) ? new Date(date) : null,
        recipientName: get("recipient-name") || get("buyer-name"),
        addressLine1: get("ship-address-1"),
        addressLine2: [get("ship-address-2"), get("ship-address-3")].filter(Boolean).join(", ") || null,
        city: get("ship-city"),
        region: get("ship-state"),
        postalCode: get("ship-postal-code"),
        country: (get("ship-country") || "US").toUpperCase(),
        phone: get("ship-phone-number") || get("buyer-phone-number") || null,
        items: [],
      };
      orders.set(id, o);
    }
    o.items.push({
      sellerSku: sku,
      cjSku: cjSkuFromSellerSku(sku),
      title: get("product-name") || sku,
      quantity: Math.floor(qty),
    });
  }
  return [...orders.values()];
}

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  MX: "Mexico",
};

/**
 * The CJ "create order" request for an Amazon order. payType 3 = create the order only;
 * you pay it yourself in CJ, as chosen for the first orders.
 * Throws when something CJ needs is missing, with a code the dashboard explains.
 */
export function cjOrderPayload(
  order: Omit<ReportOrder, "purchaseDate"> & { attempt: number },
  s: AmazonSettings,
) {
  if (!s.cjLogistic) throw new Error("CJ_LOGISTIC_NOT_SET");
  const missing = order.items.find((i) => !i.cjSku);
  if (missing) throw new Error("CJ_SKU_MISSING");
  if (!order.addressLine1 || !order.city || !order.region || !order.recipientName)
    throw new Error("ADDRESS_INCOMPLETE");
  const orderNumber =
    order.attempt > 0 ? `${order.amazonOrderId}-R${order.attempt}` : order.amazonOrderId;
  return {
    orderNumber,
    shippingCountryCode: order.country,
    shippingCountry: COUNTRY_NAMES[order.country] ?? order.country,
    shippingProvince: order.region,
    shippingCity: order.city,
    shippingCustomerName: order.recipientName.slice(0, 50),
    shippingAddress: order.addressLine1,
    shippingAddress2: order.addressLine2 ?? undefined,
    shippingZip: order.postalCode,
    shippingPhone: order.phone?.slice(0, 20) ?? undefined,
    remark: `Amazon ${s.marketplace} order ${order.amazonOrderId}`,
    payType: 3,
    logisticName: s.cjLogistic,
    fromCountryCode: s.stockCountry,
    products: order.items.map((i) => ({ sku: i.cjSku!, quantity: i.quantity })),
  };
}

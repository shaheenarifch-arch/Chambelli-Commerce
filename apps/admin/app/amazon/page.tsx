import Link from "next/link";
import { apiGet } from "../../lib/api";
import {
  checkListings,
  editProposal,
  importListings,
  importOrders,
  orderFromCj,
  propose,
  saveCjSku,
  setOrderStatus,
  setProposal,
} from "./actions";

export const dynamic = "force-dynamic";

type M = "US" | "CA" | "MX";
type Tab = "listings" | "new" | "orders";
const MARKETS: Array<{ m: M; name: string; flag: string; seller: string }> = [
  { m: "US", name: "Amazon US", flag: "🇺🇸", seller: "https://sellercentral.amazon.com" },
  { m: "CA", name: "Amazon Canada", flag: "🇨🇦", seller: "https://sellercentral.amazon.ca" },
  { m: "MX", name: "Amazon Mexico", flag: "🇲🇽", seller: "https://sellercentral.amazon.com.mx" },
];

type Listing = {
  id: string;
  sellerSku: string;
  asin: string | null;
  title: string;
  state: "LIVE" | "PROPOSED" | "APPROVED" | "REJECTED";
  amazonStatus: string | null;
  price: string | null;
  quantity: number | null;
  cjSku: string | null;
  bullets: string[];
  imageUrls: string[];
  cjCost: string | null;
  cjStock: number | null;
  minPrice: string | null;
  targetQuantity: number | null;
  alerts: string[];
  lastCheckedAt: string | null;
};
type Order = {
  id: string;
  amazonOrderId: string;
  purchaseDate: string | null;
  recipientName: string;
  city: string;
  region: string;
  country: string;
  items: Array<{ sellerSku: string; cjSku: string | null; title: string; quantity: number }>;
  status: "NEW" | "SENT_TO_CJ" | "CJ_FAILED" | "SHIPPED" | "CANCELLED";
  cjAttempts: number;
  cjOrderId: string | null;
  cjAmountUsd: string | null;
  cjError: string | null;
  tracking: string | null;
};
type Overview = {
  listings: Array<{ marketplace: string; state: string; _count: number }>;
  orders: Array<{ marketplace: string; status: string; _count: number }>;
  alerts: Array<{ marketplace: string; _count: number }>;
  settings: Array<{
    marketplace: M;
    currency: string;
    stockCountry: string;
    marginPercent: number;
    priceChecks: boolean;
    cjOrdering: boolean;
    checking: boolean;
  }>;
  cjConfigured: boolean;
};

/** Plain-words meaning of each alert, shown as a tooltip and in the legend. */
const ALERTS: Record<string, { label: string; tone: "bad" | "warn" | "info"; help: string }> = {
  OUT_OF_STOCK: {
    label: "Out of stock",
    tone: "bad",
    help: "CJ has no stock in this country's warehouse. The upload file sets Amazon quantity to 0.",
  },
  LOW_STOCK: { label: "Low stock", tone: "warn", help: "Fewer than 3 units can be sold safely." },
  BELOW_MARGIN: {
    label: "Below 30% margin",
    tone: "bad",
    help: "The Amazon price no longer covers CJ cost, shipping, Amazon's fee and your margin. The upload file raises it.",
  },
  PRICE_RAISE_OVER_10_PERCENT: {
    label: "Raise over 10%",
    tone: "warn",
    help: "Keeping the margin needs a price rise above 10%. Check before uploading.",
  },
  CJ_SKU_NOT_FOUND: {
    label: "CJ SKU not found",
    tone: "warn",
    help: "CJ doesn't know this SKU. Enter the right CJ SKU in the last column. Amazon is left unchanged.",
  },
  CJ_SKU_MISSING: {
    label: "No CJ SKU",
    tone: "warn",
    help: "This listing isn't linked to a CJ product yet.",
  },
  SHIPPING_COST_NOT_SET: {
    label: "Shipping cost not set",
    tone: "info",
    help: "Set AMAZON_<country>_SHIPPING_COST on the server to turn price checks on.",
  },
  FX_RATE_NOT_SET: {
    label: "Exchange rate not set",
    tone: "info",
    help: "Set AMAZON_<country>_USD_RATE on the server to turn price checks on.",
  },
};

const money = (v: string | number | null, cur: string) =>
  v === null || v === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(Number(v));

export default async function AmazonPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const m: M = sp.m === "CA" || sp.m === "MX" ? sp.m : "US";
  const tab: Tab = sp.tab === "new" || sp.tab === "orders" ? sp.tab : "listings";
  const alertsOnly = sp.alerts === "1";
  const search = sp.q?.slice(0, 100) ?? "";
  const market = MARKETS.find((x) => x.m === m)!;

  const listQuery = new URLSearchParams();
  if (tab === "listings") listQuery.set("state", "LIVE");
  if (alertsOnly) listQuery.set("alertsOnly", "true");
  if (search) listQuery.set("search", search);

  const [overview, listings, orders] = await Promise.all([
    apiGet<Overview>("/v1/admin/amazon/overview"),
    tab === "orders"
      ? Promise.resolve({ data: [] as Listing[], error: null })
      : apiGet<Listing[]>(`/v1/admin/amazon/${m}/listings?${listQuery}`),
    tab === "orders"
      ? apiGet<Order[]>(`/v1/admin/amazon/${m}/orders`)
      : Promise.resolve({ data: [] as Order[], error: null }),
  ]);
  const o = overview.data;
  const s = o?.settings.find((x) => x.marketplace === m);
  const cur = s?.currency ?? "USD";
  const error = overview.error ?? listings.error ?? orders.error;
  const count = (mk: string, state: string) =>
    o?.listings.find((x) => x.marketplace === mk && x.state === state)?._count ?? 0;
  const orderCount = (mk: string, status: string) =>
    o?.orders.find((x) => x.marketplace === mk && x.status === status)?._count ?? 0;
  const alertCount = (mk: string) => o?.alerts.find((x) => x.marketplace === mk)?._count ?? 0;
  const href = (p: Record<string, string>) => `/amazon?${new URLSearchParams({ m, tab, ...p })}`;
  const hidden = (
    <>
      <input type="hidden" name="m" value={m} />
      <input type="hidden" name="tab" value={tab} />
    </>
  );

  return (
    <main>
      <div>
        <h1>Amazon control</h1>
        <p className="sub">
          Love$Care on Amazon US, Canada and Mexico: stock and margin checks against CJ, new
          listings for your approval, and one-click ordering from CJ.{" "}
          <a href="#how-it-works">How it works</a>
        </p>
      </div>

      {sp.ok ? <div className="banner ok">{sp.ok}</div> : null}
      {sp.err ? <div className="banner bad">{sp.err}</div> : null}
      {error ? (
        <div className="banner bad">
          {error === "API_UNREACHABLE"
            ? "Can't reach the Chambelli API. Check that it is running on the server."
            : `The API returned an error: ${error}`}
        </div>
      ) : null}

      <nav className="markets" aria-label="Marketplaces">
        {MARKETS.map((x) => (
          <Link
            key={x.m}
            href={`/amazon?m=${x.m}&tab=${tab}`}
            className={`market ${x.m === m ? "on" : ""}`}
          >
            <span className="market-name">
              {x.flag} {x.name}
            </span>
            <span className="market-stats">
              {count(x.m, "LIVE")} live · {alertCount(x.m)} alerts · {count(x.m, "PROPOSED")} to
              approve · {orderCount(x.m, "NEW") + orderCount(x.m, "CJ_FAILED")} orders to place
            </span>
          </Link>
        ))}
      </nav>

      {s && (!s.priceChecks || !s.cjOrdering || !o?.cjConfigured) ? (
        <div className="card notice">
          <strong>{market.name} setup</strong>
          <ul>
            {!o?.cjConfigured ? (
              <li>CJ is not connected on the server. Set CJ_ACCESS_TOKEN and CJ_API_BASE_URL.</li>
            ) : null}
            {!s.priceChecks ? (
              <li>
                Price checks are off. Set <code>AMAZON_{m}_SHIPPING_COST</code>
                {m !== "US" ? (
                  <>
                    {" "}
                    and <code>AMAZON_{m}_USD_RATE</code>
                  </>
                ) : null}{" "}
                on the server. Stock checks still work.
              </li>
            ) : null}
            {!s.cjOrdering ? (
              <li>
                “Order from CJ” is off. Set <code>AMAZON_{m}_CJ_LOGISTIC</code> to the CJ shipping
                method for {s.stockCountry}-warehouse orders (the name CJ shows at checkout).
              </li>
            ) : null}
          </ul>
          <span className="stat-note">
            Stock is counted from CJ&apos;s {s.stockCountry} warehouse · margin floor{" "}
            {s.marginPercent}% after Amazon&apos;s fee.
          </span>
        </div>
      ) : null}

      <nav className="tabs" aria-label="Sections">
        <Link className={tab === "listings" ? "on" : ""} href={`/amazon?m=${m}&tab=listings`}>
          Live listings
        </Link>
        <Link className={tab === "new" ? "on" : ""} href={`/amazon?m=${m}&tab=new`}>
          New listings · approve ({count(m, "PROPOSED")})
        </Link>
        <Link className={tab === "orders" ? "on" : ""} href={`/amazon?m=${m}&tab=orders`}>
          Orders · reorder from CJ ({orderCount(m, "NEW") + orderCount(m, "CJ_FAILED")})
        </Link>
      </nav>

      {tab === "listings" ? (
        <>
          <section className="grid3">
            <form className="card step" action={importListings}>
              {hidden}
              <h2>1. Load your listings</h2>
              <p className="help">
                In{" "}
                <a href={market.seller} target="_blank" rel="noreferrer">
                  Seller Central
                </a>
                , go to Inventory → Inventory Reports → <b>All Listings Report</b>, download it, and
                choose it here. Do this once, and again after you add listings outside Chambelli.
              </p>
              <input type="file" name="report" accept=".txt,.tsv,.csv,text/plain" required />
              <button type="submit">Import report</button>
            </form>
            <form className="card step" action={checkListings}>
              {hidden}
              <h2>2. Check against CJ</h2>
              <p className="help">
                Checks each listing&apos;s CJ stock and cost. It runs automatically every 6 hours;
                use this to check now. About 2 seconds per listing.
              </p>
              <button type="submit" disabled={s?.checking}>
                {s?.checking ? "Check running…" : "Run CJ check now"}
              </button>
            </form>
            <div className="card step">
              <h2>3. Update Amazon</h2>
              <p className="help">
                Download the file and upload it in{" "}
                <a href={market.seller} target="_blank" rel="noreferrer">
                  Seller Central
                </a>{" "}
                → Catalog → Add Products via Upload → <b>Upload your inventory file</b>. It only
                changes quantity, and raises prices that fell below your margin. It never lowers a
                price.
              </p>
              <a className="button" href={`/amazon/file?m=${m}&kind=price-quantity`}>
                Download price &amp; quantity file
              </a>
            </div>
          </section>

          <section className="card">
            <div className="toolbar">
              <h2>Live listings ({listings.data?.length ?? 0})</h2>
              <form className="search" action="/amazon">
                <input type="hidden" name="m" value={m} />
                <input type="hidden" name="tab" value="listings" />
                {alertsOnly ? <input type="hidden" name="alerts" value="1" /> : null}
                <input name="q" defaultValue={search} placeholder="Search title, SKU or ASIN" />
                <button type="submit" className="secondary">
                  Search
                </button>
              </form>
              <Link
                className="chip"
                href={href(alertsOnly ? { q: search } : { alerts: "1", q: search })}
              >
                {alertsOnly ? "Showing alerts only · show all" : "Show alerts only"}
              </Link>
            </div>
            {listings.data?.length ? (
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Listing</th>
                      <th className="num">Amazon price</th>
                      <th className="num">Amazon qty</th>
                      <th className="num">CJ stock ({s?.stockCountry})</th>
                      <th className="num">CJ cost</th>
                      <th
                        className="num"
                        title="Lowest price that keeps your margin after Amazon's fee"
                      >
                        Min price
                      </th>
                      <th className="num" title="Quantity the upload file will set">
                        Set qty
                      </th>
                      <th>Alerts</th>
                      <th>CJ SKU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listings.data.map((l) => (
                      <tr key={l.id}>
                        <td className="title-cell">
                          <div>{l.title}</div>
                          <div className="stat-note">
                            {l.sellerSku}
                            {l.asin ? (
                              <>
                                {" · "}
                                <a
                                  href={`${market.seller.replace("sellercentral.", "www.")}/dp/${l.asin}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {l.asin}
                                </a>
                              </>
                            ) : null}
                            {l.amazonStatus ? ` · ${l.amazonStatus}` : ""}
                          </div>
                        </td>
                        <td className="num">{money(l.price, cur)}</td>
                        <td className="num">{l.quantity ?? "—"}</td>
                        <td className="num">{l.cjStock ?? "—"}</td>
                        <td className="num">{money(l.cjCost, "USD")}</td>
                        <td className="num">{money(l.minPrice, cur)}</td>
                        <td className="num">{l.targetQuantity ?? "—"}</td>
                        <td>
                          <div className="alerts">
                            {l.alerts.length ? (
                              l.alerts.map((a) => (
                                <span
                                  key={a}
                                  className={`pill tone-${ALERTS[a]?.tone ?? "info"}`}
                                  title={ALERTS[a]?.help}
                                >
                                  {ALERTS[a]?.label ?? a}
                                </span>
                              ))
                            ) : l.lastCheckedAt ? (
                              <span className="pill tone-good">OK</span>
                            ) : (
                              <span className="stat-note">Not checked yet</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <form action={saveCjSku} className="inline">
                            {hidden}
                            <input type="hidden" name="id" value={l.id} />
                            <input
                              name="cjSku"
                              defaultValue={l.cjSku ?? ""}
                              placeholder="CJ SKU"
                              aria-label="CJ SKU"
                            />
                            <button type="submit" className="secondary small">
                              Save
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">
                {alertsOnly || search
                  ? "Nothing matches."
                  : "No listings yet. Import the All Listings report above."}
              </p>
            )}
            <details className="legend">
              <summary>What the alerts mean</summary>
              <ul>
                {Object.values(ALERTS).map((a) => (
                  <li key={a.label}>
                    <span className={`pill tone-${a.tone}`}>{a.label}</span> {a.help}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        </>
      ) : null}

      {tab === "new" ? (
        <>
          <section className="grid2">
            <form className="card step" action={propose}>
              {hidden}
              <h2>Draft new listings from CJ</h2>
              <p className="help">
                Paste CJ SKUs (up to 25, separated by commas or new lines). Chambelli only drafts
                items CJ stocks in its {s?.stockCountry} warehouse, using CJ&apos;s real product
                photos, and prices them at your {s?.marginPercent}% margin. Nothing goes to Amazon
                until you approve it.
              </p>
              <textarea name="cjSkus" rows={4} placeholder={"CJJT2541636\nCJZS2593773"} required />
              <button type="submit">Draft listings</button>
            </form>
            <div className="card step">
              <h2>Send approved listings to Amazon</h2>
              <p className="help">
                Download the approved listings (title, price, quantity, 5 bullets, description,
                photo links) and copy them into Amazon&apos;s category template in{" "}
                <a href={market.seller} target="_blank" rel="noreferrer">
                  Seller Central
                </a>{" "}
                → Catalog → Add Products via Upload. Once SP-API access is approved, this step
                becomes automatic.
              </p>
              <p className="stat-note">{count(m, "APPROVED")} approved and waiting to upload.</p>
              <a className="button" href={`/amazon/file?m=${m}&kind=new-listings`}>
                Download approved listings
              </a>
            </div>
          </section>

          {(["PROPOSED", "APPROVED", "REJECTED"] as const).map((state) => {
            const rows = listings.data?.filter((l) => l.state === state) ?? [];
            if (!rows.length && state !== "PROPOSED") return null;
            return (
              <section className="card" key={state}>
                <h2>
                  {state === "PROPOSED"
                    ? "Waiting for your approval"
                    : state === "APPROVED"
                      ? "Approved"
                      : "Rejected"}{" "}
                  ({rows.length})
                </h2>
                {rows.length ? (
                  <div className="proposals">
                    {rows.map((l) => (
                      <article key={l.id} className={`proposal ${state.toLowerCase()}`}>
                        <div className="photos">
                          {l.imageUrls.slice(0, 4).map((u) => (
                            <img key={u} src={u} alt="" loading="lazy" />
                          ))}
                        </div>
                        <form action={editProposal} className="proposal-form">
                          {hidden}
                          <input type="hidden" name="id" value={l.id} />
                          <label>
                            Title <span className="stat-note">(max 200 characters)</span>
                            <textarea
                              name="title"
                              rows={2}
                              defaultValue={l.title}
                              maxLength={200}
                            />
                          </label>
                          {[0, 1, 2, 3, 4].map((i) => (
                            <input
                              key={i}
                              name={`bullet${i + 1}`}
                              defaultValue={l.bullets[i] ?? ""}
                              placeholder={`Bullet ${i + 1}`}
                              maxLength={500}
                            />
                          ))}
                          <div className="facts">
                            <label>
                              Price ({cur})
                              <input
                                name="price"
                                type="number"
                                step="0.01"
                                min={l.minPrice ?? 0}
                                defaultValue={l.price ?? ""}
                              />
                            </label>
                            <span>Min {money(l.minPrice, cur)}</span>
                            <span>CJ cost {money(l.cjCost, "USD")}</span>
                            <span>
                              Stock {l.cjStock ?? "—"} · list {l.targetQuantity ?? "—"}
                            </span>
                            <span className="stat-note">{l.cjSku}</span>
                          </div>
                          {l.alerts.length ? (
                            <div className="alerts">
                              {l.alerts.map((a) => (
                                <span
                                  key={a}
                                  className={`pill tone-${ALERTS[a]?.tone ?? "info"}`}
                                  title={ALERTS[a]?.help}
                                >
                                  {ALERTS[a]?.label ?? a}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <button type="submit" className="secondary small">
                            Save changes
                          </button>
                        </form>
                        <div className="decide">
                          {state !== "APPROVED" ? (
                            <form action={setProposal}>
                              {hidden}
                              <input type="hidden" name="id" value={l.id} />
                              <input type="hidden" name="state" value="APPROVED" />
                              <button type="submit" className="approve">
                                Approve
                              </button>
                            </form>
                          ) : null}
                          {state !== "REJECTED" ? (
                            <form action={setProposal}>
                              {hidden}
                              <input type="hidden" name="id" value={l.id} />
                              <input type="hidden" name="state" value="REJECTED" />
                              <button type="submit" className="reject">
                                Reject
                              </button>
                            </form>
                          ) : null}
                          {state !== "PROPOSED" ? (
                            <form action={setProposal}>
                              {hidden}
                              <input type="hidden" name="id" value={l.id} />
                              <input type="hidden" name="state" value="PROPOSED" />
                              <button type="submit" className="secondary small">
                                Back to review
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="empty">Nothing waiting. Draft new listings from CJ SKUs above.</p>
                )}
              </section>
            );
          })}
        </>
      ) : null}

      {tab === "orders" ? (
        <>
          <section className="grid2">
            <form className="card step" action={importOrders}>
              {hidden}
              <h2>Load new Amazon orders</h2>
              <p className="help">
                In{" "}
                <a href={market.seller} target="_blank" rel="noreferrer">
                  Seller Central
                </a>
                , go to Orders → Order Reports → <b>Unshipped Orders</b>, download the report and
                choose it here. Orders already sent to CJ are never changed by a re-import.
              </p>
              <input type="file" name="report" accept=".txt,.tsv,text/plain" required />
              <button type="submit">Import orders</button>
            </form>
            <div className="card step">
              <h2>How ordering from CJ works</h2>
              <p className="help">
                “Order from CJ” creates the CJ order with the buyer&apos;s address and the matching
                CJ SKUs, shipped from CJ&apos;s {s?.stockCountry} warehouse. It is created unpaid:
                pay it in your{" "}
                <a href="https://cjdropshipping.com/myCJ.html" target="_blank" rel="noreferrer">
                  CJ dashboard
                </a>
                . “Reorder” sends it again (for example after a lost parcel) and asks you to confirm
                first, so a double click never buys twice. When CJ gives tracking, mark the order
                shipped here and confirm shipment in Seller Central.
              </p>
            </div>
          </section>

          <section className="card">
            <h2>Orders ({orders.data?.length ?? 0})</h2>
            {orders.data?.length ? (
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Ship to</th>
                      <th>Items</th>
                      <th>Status</th>
                      <th>CJ</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.data.map((od) => (
                      <tr key={od.id}>
                        <td>
                          <a
                            href={`${market.seller}/orders-v3/order/${od.amazonOrderId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {od.amazonOrderId}
                          </a>
                          <div className="stat-note">
                            {od.purchaseDate ? new Date(od.purchaseDate).toLocaleString() : ""}
                          </div>
                        </td>
                        <td>
                          {od.recipientName}
                          <div className="stat-note">
                            {od.city}, {od.region} {od.country}
                          </div>
                        </td>
                        <td>
                          {od.items.map((i) => (
                            <div key={i.sellerSku} className="item-line">
                              {i.quantity} × {i.title.slice(0, 60)}
                              <div className="stat-note">{i.cjSku ?? "no CJ SKU"}</div>
                            </div>
                          ))}
                        </td>
                        <td>
                          <span className={`pill order-${od.status}`}>
                            {od.status.replace(/_/g, " ").toLowerCase()}
                          </span>
                          {od.tracking ? (
                            <div className="stat-note">Tracking {od.tracking}</div>
                          ) : null}
                        </td>
                        <td>
                          {od.cjOrderId ? (
                            <>
                              <div>{od.cjOrderId}</div>
                              <div className="stat-note">
                                {money(od.cjAmountUsd, "USD")} · sent {od.cjAttempts}×
                              </div>
                            </>
                          ) : (
                            <span className="stat-note">Not ordered</span>
                          )}
                          {od.cjError ? <div className="error-text">{od.cjError}</div> : null}
                        </td>
                        <td className="actions">
                          {od.status === "NEW" || od.status === "CJ_FAILED" ? (
                            <form action={orderFromCj}>
                              {hidden}
                              <input type="hidden" name="id" value={od.id} />
                              <button type="submit" className="approve" disabled={!s?.cjOrdering}>
                                {od.status === "CJ_FAILED" ? "Try CJ again" : "Order from CJ"}
                              </button>
                            </form>
                          ) : null}
                          {od.status === "SENT_TO_CJ" ? (
                            <form action={orderFromCj} className="reorder">
                              {hidden}
                              <input type="hidden" name="id" value={od.id} />
                              <label className="confirm">
                                <input type="checkbox" name="force" required /> Yes, order again
                              </label>
                              <button
                                type="submit"
                                className="secondary small"
                                disabled={!s?.cjOrdering}
                              >
                                Reorder from CJ
                              </button>
                            </form>
                          ) : null}
                          {od.status === "SENT_TO_CJ" ? (
                            <form action={setOrderStatus} className="inline">
                              {hidden}
                              <input type="hidden" name="id" value={od.id} />
                              <input type="hidden" name="status" value="SHIPPED" />
                              <input
                                name="tracking"
                                placeholder="Tracking #"
                                aria-label="Tracking number"
                              />
                              <button type="submit" className="secondary small">
                                Mark shipped
                              </button>
                            </form>
                          ) : null}
                          {od.status !== "CANCELLED" && od.status !== "SHIPPED" ? (
                            <form action={setOrderStatus}>
                              {hidden}
                              <input type="hidden" name="id" value={od.id} />
                              <input type="hidden" name="status" value="CANCELLED" />
                              <button type="submit" className="reject small">
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <form action={setOrderStatus}>
                              {hidden}
                              <input type="hidden" name="id" value={od.id} />
                              <input type="hidden" name="status" value="NEW" />
                              <button type="submit" className="secondary small">
                                Reopen
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">No orders yet. Import the Unshipped Orders report above.</p>
            )}
          </section>
        </>
      ) : null}

      <section className="card" id="how-it-works">
        <h2>How it works</h2>
        <ul className="help-list">
          <li>
            <b>Until Amazon approves API access</b>, Chambelli can&apos;t change Amazon directly. It
            prepares upload files and you upload them in Seller Central. Once the SP-API production
            app is approved, the uploads and order imports become automatic, and price rises over
            10% and new listings still wait for you.
          </li>
          <li>
            <b>Stock</b> comes from CJ&apos;s warehouse in the same country (US for Amazon US,
            Canada for Amazon.ca, Mexico for Amazon.com.mx). Chambelli holds back 2 units and never
            lists more than 10, so you don&apos;t oversell.
          </li>
          <li>
            <b>Price</b> must cover CJ cost, shipping, Amazon&apos;s 15% referral fee and your 30%
            margin. Chambelli only ever raises a price that fell below that, never lowers one.
          </li>
          <li>
            <b>Help:</b>{" "}
            <a href={`${market.seller}/help/hub`} target="_blank" rel="noreferrer">
              Seller Central help
            </a>{" "}
            ·{" "}
            <a href="https://developers.cjdropshipping.com/" target="_blank" rel="noreferrer">
              CJ API docs
            </a>
          </li>
        </ul>
      </section>
    </main>
  );
}

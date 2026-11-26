import Link from "next/link";
import { apiGet } from "../../lib/api";
import { approve, decidePrices, setActive } from "./actions";

export const dynamic = "force-dynamic";

/** Each carousel should carry 20 to 50 products (config/cj-site-map.json). */
const MIN = 20;
const MAX = 50;
/** Public address of the widget, as sites load it. */
const WIDGET_BASE = process.env.PUBLIC_WIDGET_BASE_URL ?? "https://chambelli.getservices.ai";

type Site = {
  id: string;
  name: string;
  slug: string;
  domain: string;
  active: boolean;
  market: string;
  currency: string;
  live: number;
  waiting: number;
  removed: number;
  priceChanges?: number;
  approving: boolean;
};
type Row = {
  productId: string;
  active: boolean;
  product: {
    id: string;
    title: string;
    imageUrl: string | null;
    status: string;
    category: string;
    variants: Array<{
      id: string;
      price: string;
      quantity: number;
      currency: string;
      pendingPrice: string | null;
      pendingPriceAt: string | null;
    }>;
    supplierProducts: Array<{ supplierPrice: string }>;
  };
};

const usd = (v: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v));
/** Shows a price in its own currency (GBP on UK sites, EUR on Germany sites). */
const money = (v: string | number, currency: string) =>
  new Intl.NumberFormat(currency === "GBP" ? "en-GB" : currency === "EUR" ? "en-DE" : "en-US", {
    style: "currency",
    currency,
  }).format(Number(v));

export default async function CarouselsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const sites = await apiGet<Site[]>("/v1/admin/sites");
  const selected = sites.data?.find((s) => s.slug === sp.site) ?? sites.data?.[0];
  const detail = selected
    ? await apiGet<{ rows: Row[] }>(`/v1/admin/sites/${selected.slug}/products`)
    : { data: null, error: null };
  const rows = detail.data?.rows ?? [];
  const uk = selected?.market === "UK";
  const de = selected?.market === "DE";
  // UK/Germany products are live only once they have an in-stock GBP/EUR price.
  const isLive = (r: Row) =>
    r.active &&
    r.product.status === "ACTIVE" &&
    ((!uk && !de) ||
      r.product.variants.some((v) => v.currency === selected?.currency && v.quantity > 0));
  const waiting = rows.filter((r) => r.active && !isLive(r));
  const live = rows.filter(isLive);
  const removed = rows.filter((r) => !r.active);
  // Price hold: new CJ prices on live UK/Germany products wait here for your OK.
  const priceChanges = live.flatMap((r) =>
    r.product.variants
      .filter((v) => v.currency === selected?.currency && v.pendingPrice !== null)
      .map((v) => ({ row: r, v })),
  );
  const error = sites.error ?? detail.error;
  const embed = selected
    ? `<script async src="${WIDGET_BASE}/widget.js" data-api="${WIDGET_BASE}" data-site="${selected.slug}" data-placement="article-footer" data-title="Shop Chambelli picks"></script>`
    : "";

  return (
    <main>
      <div>
        <h1>Website carousels</h1>
        <p className="sub">
          One Chambelli carousel at the top of each site: {MIN} to {MAX} CJ products from the US
          warehouse, with left and right arrows. Approve products here; nothing shows until you do.
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

      <nav className="sitegrid" aria-label="Websites">
        {sites.data?.map((s) => {
          const pct = Math.min(100, Math.round((s.live / MAX) * 100));
          return (
            <Link
              key={s.id}
              href={`/carousels?site=${s.slug}`}
              className={`sitecard ${s.slug === selected?.slug ? "on" : ""}`}
            >
              <span className="market-name">{s.name}</span>
              <span className="market-stats">{s.domain}</span>
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${pct}%` }} className={s.live >= MIN ? "full" : ""} />
              </span>
              <span className="market-stats">
                {s.live} live · {s.waiting} waiting{" "}
                {s.live < MIN ? (
                  <span className="pill FAILED">needs {MIN - s.live} more</span>
                ) : (
                  <span className="pill tone-good">ready</span>
                )}
                {s.priceChanges ? (
                  <span className="pill tone-info">{s.priceChanges} new prices</span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </nav>
      {!sites.data?.length && !error ? (
        <p className="empty">
          No sites yet. They appear after the next CJ sync reads config/cj-site-map.json.
        </p>
      ) : null}

      {selected ? (
        <>
          <section className="grid2">
            <div className="card step">
              <h2>
                {selected.name} · {live.length} live of {MIN}–{MAX}
              </h2>
              {uk ? (
                <p className="help">
                  🇬🇧 <b>UK site</b>: <b>Approve</b> prices each product in GBP at your 30% margin
                  with UK delivery (and VAT, if set) built in, checks CJ&apos;s UK warehouse stock,
                  and puts it live. Products with no UK stock stay waiting. Settings:{" "}
                  <a
                    href="https://github.com/shaheenarifch-arch/Chambelli-Commerce/blob/main/docs/UK.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    UK guide
                  </a>
                  .
                </p>
              ) : de ? (
                <p className="help">
                  🇩🇪 <b>Germany site</b>: <b>Approve</b> prices each product in EUR at your 30%
                  margin with delivery in Germany (and VAT, if set) built in, checks CJ&apos;s
                  German warehouse stock, and puts it live. Products with no German stock stay
                  waiting. Settings:{" "}
                  <a
                    href="https://github.com/shaheenarifch-arch/Chambelli-Commerce/blob/main/docs/DE.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Germany guide
                  </a>
                  .
                </p>
              ) : (
                <p className="help">
                  <b>Approve</b> prices each product at your 30% margin with US shipping built in,
                  checks CJ&apos;s US warehouse stock, and puts it live. Products CJ has no US stock
                  for stay off. Tick products to approve just those, or approve everything waiting
                  (up to {MAX} at a time).
                </p>
              )}
              <p className="help">
                CJ allows about one request per second: approve <b>one site at a time</b>.
              </p>
              <form action={approve}>
                <input type="hidden" name="site" value={selected.slug} />
                <input type="hidden" name="market" value={uk ? "UK" : de ? "DE" : "US"} />
                <button
                  type="submit"
                  className="approve"
                  disabled={selected.approving || !waiting.length}
                >
                  {selected.approving ? "Approving…" : `Approve all ${waiting.length} waiting`}
                </button>
              </form>
            </div>
            <div className="card step">
              <h2>Put the carousel on {selected.domain}</h2>
              <p className="help">
                Paste this once at the <b>top</b> of the site&apos;s pages, above the Amazon and
                affiliate sections. It only shows approved products, and it hides itself if there
                are none.
              </p>
              <pre className="code">{embed}</pre>
            </div>
          </section>

          {uk || de ? (
            <section className="card">
              <form>
                <input type="hidden" name="site" value={selected.slug} />
                <div className="toolbar">
                  <h2>New prices waiting for your OK ({priceChanges.length})</h2>
                  {priceChanges.length ? (
                    <>
                      <button
                        formAction={decidePrices}
                        name="accept"
                        value="true"
                        className="approve small"
                      >
                        Accept ticked prices
                      </button>
                      <button
                        formAction={decidePrices}
                        name="accept"
                        value="false"
                        className="secondary small"
                      >
                        Keep current prices
                      </button>
                    </>
                  ) : null}
                </div>
                <p className="help">
                  When CJ&apos;s cost changes, the 6-hourly sync works out a new price but does not
                  change what shoppers see. It waits here until you accept it. If you keep the
                  current price, that same new price is not offered again. Sold-out products still
                  come off the carousel by themselves.
                </p>
                {priceChanges.length ? (
                  <div className="pgrid">
                    {priceChanges.map(({ row, v }) => (
                      <label key={v.id} className="pcard">
                        <input type="checkbox" name="variantId" value={v.id} />
                        {row.product.imageUrl ? (
                          <img src={row.product.imageUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="noimg">No photo</span>
                        )}
                        <span className="ptitle">{row.product.title}</span>
                        <span className="stat-note">
                          Now {money(v.price, v.currency)} · new{" "}
                          {money(v.pendingPrice!, v.currency)}
                          {v.pendingPriceAt
                            ? ` · since ${new Date(v.pendingPriceAt).toLocaleDateString("en-US")}`
                            : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="empty">No price changes waiting.</p>
                )}
              </form>
            </section>
          ) : null}

          {[
            { title: "Waiting for approval", list: waiting, kind: "waiting" },
            { title: "Live on the carousel", list: live, kind: "live" },
            { title: "Removed", list: removed, kind: "removed" },
          ].map(({ title, list, kind }) =>
            list.length || kind === "waiting" ? (
              <section className="card" key={kind}>
                <form>
                  <input type="hidden" name="site" value={selected.slug} />
                  <input
                    type="hidden"
                    name="active"
                    value={kind === "removed" ? "true" : "false"}
                  />
                  <div className="toolbar">
                    <h2>
                      {title} ({list.length})
                    </h2>
                    {kind === "waiting" && list.length ? (
                      <button
                        formAction={approve}
                        className="approve small"
                        disabled={selected.approving}
                      >
                        Approve ticked
                      </button>
                    ) : null}
                    {list.length ? (
                      <button
                        formAction={setActive}
                        className={kind === "removed" ? "secondary small" : "reject small"}
                      >
                        {kind === "removed" ? "Put ticked back" : "Remove ticked"}
                      </button>
                    ) : null}
                  </div>
                  {list.length ? (
                    <div className="pgrid">
                      {list.map((r) => {
                        const v = r.product.variants[0];
                        const cost = r.product.supplierProducts[0]?.supplierPrice;
                        return (
                          <label key={r.productId} className="pcard">
                            <input type="checkbox" name="productId" value={r.productId} />
                            {r.product.imageUrl ? (
                              <img src={r.product.imageUrl} alt="" loading="lazy" />
                            ) : (
                              <span className="noimg">No photo</span>
                            )}
                            <span className="ptitle">{r.product.title}</span>
                            <span className="stat-note">
                              {v
                                ? `${money(v.price, v.currency)} · ${v.quantity} in stock`
                                : cost
                                  ? `CJ cost ${usd(cost)}`
                                  : "No CJ price"}
                              {!uk && !de && r.product.status === "OUT_OF_STOCK"
                                ? " · no US stock"
                                : ""}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="empty">
                      Nothing waiting. The CJ sync links up to {MAX} matching products to each site
                      every 6 hours.
                    </p>
                  )}
                </form>
              </section>
            ) : null,
          )}
        </>
      ) : null}

      <section className="card">
        <h2>How it works</h2>
        <ul className="help-list">
          <li>
            Which CJ categories feed which site is set in <code>config/cj-site-map.json</code> (
            <a
              href="https://github.com/shaheenarifch-arch/Chambelli-Commerce/blob/main/docs/CJ-SITE-MAP.md"
              target="_blank"
              rel="noreferrer"
            >
              guide
            </a>
            ). firearmsafety.us only takes safety and protective gear (safes, rifle safes and
            lockers, gun locks, fingerprint and keypad locks, child-safety locks and cabinets,
            helmets, shields, hearing and eye protection, night vision, flashlights, first aid); no
            weapons, ammo or body armor; medicalsupplie.com only everyday non-prescription supplies.
          </li>
          <li>
            Only CJ US-warehouse stock is sold; a product goes off the carousel by itself when its
            stock runs out.
          </li>
          <li>
            Prices include CJ US shipping (<code>SITE_US_SHIPPING_COST</code> on the server) and
            keep at least a 30% margin.
          </li>
        </ul>
      </section>
    </main>
  );
}

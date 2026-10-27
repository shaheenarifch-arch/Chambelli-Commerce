export const dynamic = "force-dynamic";

const api = process.env.PUBLIC_API_BASE_URL ?? "http://localhost:8080";
const NETWORK_TARGET = 28;

type Product = {
  id: string;
  title: string;
  status: string;
  category: string;
  imageUrl: string | null;
  supplierType: string;
  variants: Array<{ price: string; quantity: number; currency: string }>;
  score: { finalScore: number } | null;
};
type Website = {
  id: string;
  name: string;
  domain: string;
  active: boolean;
  _count?: { assignments: number };
};
type Overview = {
  days: number;
  sales: { orders: number; grossOrderValue: number; successfulPayments: number; discounts: number };
  products: Record<string, number>;
  activeWebsites: number;
  events: Record<string, number>;
  lastSync: { status: string; processed: number; failures: number; startedAt: string } | null;
};

async function get<T>(path: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const r = await fetch(api + path, {
      headers: { "x-admin-key": process.env.ADMIN_API_KEY ?? "" },
      cache: "no-store",
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      return { data: null, error: body.error ?? `HTTP ${r.status}` };
    }
    return { data: (await r.json()) as T, error: null };
  } catch {
    return { data: null, error: "API_UNREACHABLE" };
  }
}

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

export default async function Page() {
  const [overview, products, sites] = await Promise.all([
    get<Overview>("/v1/admin/overview?days=30"),
    get<{ items: Product[]; total: number }>("/v1/admin/products?limit=12"),
    get<Website[]>("/v1/admin/websites"),
  ]);
  const error = overview.error ?? products.error ?? sites.error;
  const o = overview.data;
  const ev = o?.events ?? {};
  const impressions = ev.IMPRESSION ?? 0;
  const clicks = ev.CLICK ?? 0;
  const totalProducts = products.data?.total ?? 0;

  return (
    <main>
      <div>
        <h1>Commerce Command Center</h1>
        <p className="sub">Last 30 days across the Chambelli network</p>
      </div>

      {error ? (
        <div className="banner">
          {error === "API_UNREACHABLE"
            ? `Cannot reach the API at ${api}. Start it with "pnpm dev:api".`
            : error === "ADMIN_NOT_CONFIGURED" || error === "UNAUTHORIZED"
              ? "Admin key missing or wrong. Set the same ADMIN_API_KEY for the API and the dashboard."
              : `The API returned an error: ${error}`}
        </div>
      ) : null}

      <section className="stats">
        <Stat
          label="Gross order value"
          value={money(o?.sales.grossOrderValue ?? 0)}
          note={`${o?.sales.orders ?? 0} orders`}
        />
        <Stat
          label="Payments received"
          value={money(o?.sales.successfulPayments ?? 0)}
          note={`${money(o?.sales.discounts ?? 0)} in discounts`}
        />
        <Stat
          label="Carousel CTR"
          value={pct(clicks, impressions)}
          note={`${clicks.toLocaleString()} clicks · ${impressions.toLocaleString()} views`}
        />
        <Stat
          label="Live products"
          value={(o?.products.ACTIVE ?? 0).toLocaleString()}
          note={`${totalProducts.toLocaleString()} in the hub`}
        />
        <Stat
          label="Websites live"
          value={`${o?.activeWebsites ?? 0} / ${NETWORK_TARGET}`}
          note="network target"
        />
      </section>

      <section className="grid2">
        <div className="card">
          <h2>Recent products</h2>
          {products.data?.items.length ? (
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Product</th>
                  <th>Status</th>
                  <th className="num">Price</th>
                  <th className="num">Stock</th>
                  <th className="num">Score</th>
                </tr>
              </thead>
              <tbody>
                {products.data.items.map((p) => {
                  const v = p.variants[0];
                  const stock = p.variants.reduce((s, x) => s + x.quantity, 0);
                  return (
                    <tr key={p.id}>
                      <td>
                        {p.imageUrl ? (
                          <img className="thumb" src={p.imageUrl} alt="" />
                        ) : (
                          <span className="thumb" />
                        )}
                      </td>
                      <td>
                        <div>{p.title}</div>
                        <div className="stat-note">
                          {p.category} · {p.supplierType}
                        </div>
                      </td>
                      <td>
                        <span className={`pill ${p.status}`}>{p.status.replace(/_/g, " ")}</span>
                      </td>
                      <td className="num">
                        {v ? `${v.currency} ${Number(v.price).toFixed(2)}` : "—"}
                      </td>
                      <td className="num">{stock}</td>
                      <td className="num">{p.score ? p.score.finalScore.toFixed(2) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="empty">No products yet. Run "pnpm db:seed" or configure the CJ sync.</p>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <h2>CJ product sync</h2>
            {o?.lastSync ? (
              <div className="rows">
                <div className="row">
                  <span>Status</span>
                  <span className={`pill ${o.lastSync.status}`}>
                    {o.lastSync.status.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="row">
                  <span>Products processed</span>
                  <span>{o.lastSync.processed.toLocaleString()}</span>
                </div>
                <div className="row">
                  <span>Failures</span>
                  <span>{o.lastSync.failures}</span>
                </div>
                <div className="row">
                  <span>Started</span>
                  <span>{new Date(o.lastSync.startedAt).toLocaleString()}</span>
                </div>
              </div>
            ) : (
              <p className="empty">No sync has run yet.</p>
            )}
          </div>
          <div className="card">
            <h2>Product pipeline</h2>
            <div className="rows">
              {["ACTIVE", "DRAFT", "PENDING_REVIEW", "PAUSED", "OUT_OF_STOCK"].map((s) => (
                <div className="row" key={s}>
                  <span>{s.replace(/_/g, " ").toLowerCase()}</span>
                  <span>{(o?.products[s] ?? 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Websites</h2>
        {sites.data?.length ? (
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th>Domain</th>
                <th>Status</th>
                <th className="num">Products assigned</th>
              </tr>
            </thead>
            <tbody>
              {sites.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="stat-note">{s.domain}</td>
                  <td>
                    <span className={`pill ${s.active ? "ACTIVE" : "ARCHIVED"}`}>
                      {s.active ? "LIVE" : "OFF"}
                    </span>
                  </td>
                  <td className="num">{s._count?.assignments ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">No websites registered yet.</p>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note ? <div className="stat-note">{note}</div> : null}
    </div>
  );
}

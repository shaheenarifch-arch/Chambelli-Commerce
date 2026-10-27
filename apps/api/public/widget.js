/*!
 * Chambelli product carousel widget.
 *
 * <script async src="https://API_HOST/widget.js"
 *   data-api="https://API_HOST"
 *   data-site="tech"
 *   data-placement="article-footer"
 *   data-title="Recommended Products"
 *   data-product-url="https://tech.example.com/shop/{slug}"></script>
 *
 * data-product-url is optional; {slug} and {id} are replaced per product.
 */
(() => {
  const s = document.currentScript;
  if (!s) return;
  const site = s.dataset.site;
  const api = (s.dataset.api || "").replace(/\/$/, "");
  const placement = s.dataset.placement || "article-footer";
  const title = s.dataset.title || "Recommended Products";
  const urlTemplate = s.dataset.productUrl || "";
  if (!site || !api) return;

  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const safeUrl = (u) => {
    try {
      const parsed = new URL(u, location.href);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
    } catch {
      return "";
    }
  };
  const productUrl = (p) =>
    urlTemplate
      ? safeUrl(
          urlTemplate
            .replace("{slug}", encodeURIComponent(p.slug))
            .replace("{id}", encodeURIComponent(p.id)),
        )
      : "";
  const money = (amount, currency) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
    } catch {
      return `${currency} ${Number(amount).toFixed(2)}`;
    }
  };

  const sessionId = (() => {
    const key = "chambelli-session";
    try {
      let id = sessionStorage.getItem(key);
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem(key, id);
      }
      return id;
    } catch {
      return undefined;
    }
  })();

  const track = (eventType, p) =>
    fetch(`${api}/v1/analytics`, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        websiteSlug: site,
        productId: p?.id,
        eventType,
        placement,
        position: p?.position,
        sessionId,
      }),
    }).catch(() => {});

  const host = document.createElement("div");
  host.className = "chambelli-carousel";
  s.after(host);
  const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  const css = `
    :host{all:initial;display:block;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111827}
    section{margin:32px 0}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
    h2{font-size:20px;font-weight:700;margin:0;letter-spacing:-.01em}
    .nav{display:flex;gap:8px}
    .nav button{width:36px;height:36px;border-radius:999px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;font-size:18px;line-height:1;color:#111827}
    .nav button:hover{background:#f3f4f6}
    .track{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;padding:2px 2px 10px;scrollbar-width:thin}
    .card{flex:0 0 220px;scroll-snap-align:start;background:#fff;border:1px solid #eef0f3;border-radius:16px;overflow:hidden;text-decoration:none;color:inherit;transition:box-shadow .2s,transform .2s;display:flex;flex-direction:column}
    a.card:hover{box-shadow:0 10px 24px rgba(17,24,39,.08);transform:translateY(-2px)}
    .img{position:relative;aspect-ratio:1;background:#f3f4f6}
    .img img{width:100%;height:100%;object-fit:cover;display:block}
    .badge{position:absolute;top:10px;left:10px;background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px}
    .body{padding:12px 14px 16px;display:flex;flex-direction:column;gap:6px}
    h3{font-size:14px;font-weight:600;margin:0;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .price{font-size:15px;font-weight:700}
    .was{color:#9ca3af;text-decoration:line-through;font-weight:500;font-size:13px;margin-left:6px}
    @media (max-width:640px){.card{flex-basis:160px}.nav{display:none}}
    @media (prefers-color-scheme:dark){:host{color:#f3f4f6}.card{background:#111827;border-color:#1f2937}.nav button{background:#111827;border-color:#374151;color:#f3f4f6}.img{background:#1f2937}}
  `;

  fetch(`${api}/v1/carousels/${encodeURIComponent(site)}/${encodeURIComponent(placement)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((d) => {
      const products = Array.isArray(d.products) ? d.products : [];
      if (!products.length) return host.remove();
      const cards = products
        .map((p) => {
          const href = productUrl(p);
          const tag = href ? "a" : "div";
          const onSale = p.compareAtPrice && p.compareAtPrice > p.price;
          return `<${tag} class="card" data-id="${esc(p.id)}"${href ? ` href="${esc(href)}" rel="sponsored noopener"` : ""}>
            <div class="img">${p.imageUrl ? `<img loading="lazy" alt="${esc(p.title)}" src="${esc(safeUrl(p.imageUrl))}">` : ""}${onSale ? `<span class="badge">Sale</span>` : ""}</div>
            <div class="body"><h3>${esc(p.title)}</h3>
            <div class="price">${esc(money(p.price, p.currency))}${onSale ? `<span class="was">${esc(money(p.compareAtPrice, p.currency))}</span>` : ""}</div></div>
          </${tag}>`;
        })
        .join("");
      root.innerHTML = `<style>${css}</style><section aria-label="${esc(title)}">
        <header><h2>${esc(title)}</h2><div class="nav"><button type="button" data-dir="-1" aria-label="Previous">&#8249;</button><button type="button" data-dir="1" aria-label="Next">&#8250;</button></div></header>
        <div class="track">${cards}</div></section>`;

      const byId = new Map(products.map((p) => [String(p.id), p]));
      const trackEl = root.querySelector(".track");
      root
        .querySelectorAll(".nav button")
        .forEach((b) =>
          b.addEventListener("click", () =>
            trackEl.scrollBy({ left: Number(b.dataset.dir) * trackEl.clientWidth * 0.9 }),
          ),
        );
      root
        .querySelectorAll("a.card")
        .forEach((el) =>
          el.addEventListener("click", () => track("CLICK", byId.get(el.dataset.id))),
        );
      track("CAROUSEL_LOAD");
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver(
          (entries) =>
            entries.forEach((e) => {
              if (!e.isIntersecting) return;
              io.unobserve(e.target);
              track("IMPRESSION", byId.get(e.target.dataset.id));
            }),
          { threshold: 0.5 },
        );
        root.querySelectorAll(".card").forEach((el) => io.observe(el));
      }
    })
    .catch(() => host.remove());
})();

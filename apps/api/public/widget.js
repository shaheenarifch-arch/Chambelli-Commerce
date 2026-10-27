(() => {
  const s = document.currentScript;
  if (!s) return;
  const site = s.dataset.site,
    placement = s.dataset.placement || "article-footer",
    api = s.dataset.api;
  if (!site || !api) return;
  const root = document.createElement("div");
  root.className = "chambelli-carousel";
  s.after(root);
  fetch(`${api}/v1/carousels/${encodeURIComponent(site)}/${encodeURIComponent(placement)}`)
    .then((r) => r.json())
    .then((d) => {
      root.innerHTML = `<section><h2>Recommended Products</h2><div style="display:flex;gap:16px;overflow:auto">${(d.products || []).map((p) => `<article style="min-width:220px;border:1px solid #ddd;border-radius:14px;padding:14px"><img loading="lazy" alt="${p.title}" src="${p.imageUrl || ""}" style="width:100%;aspect-ratio:1;object-fit:cover"><h3>${p.title}</h3><strong>${p.currency} ${p.price}</strong></article>`).join("")}</div></section>`;
    })
    .catch(() => root.remove());
})();

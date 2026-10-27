"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";

export interface CarouselProduct {
  id: string;
  variantId: string;
  slug: string;
  title: string;
  imageUrl?: string | null;
  price: number;
  compareAtPrice?: number | null;
  currency: string;
  position: number;
}

export interface CommerceCarouselProps {
  site: string;
  apiBase: string;
  placement?: string;
  title?: string;
  /** Where a product card links to on your site. Without it, cards are not links. */
  productUrl?: (product: CarouselProduct) => string;
}

const SESSION_KEY = "chambelli-session";

function getSessionId(): string | undefined {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const css = `
.chc{margin:32px 0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:inherit}
.chc-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.chc-head h2{font-size:20px;font-weight:700;margin:0;letter-spacing:-.01em}
.chc-nav{display:flex;gap:8px}
.chc-nav button{width:36px;height:36px;border-radius:999px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;font-size:18px;line-height:1;color:#111827}
.chc-track{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;padding:2px 2px 10px}
.chc-card{flex:0 0 220px;scroll-snap-align:start;background:#fff;border:1px solid #eef0f3;border-radius:16px;overflow:hidden;text-decoration:none;color:#111827;display:flex;flex-direction:column;transition:box-shadow .2s,transform .2s}
a.chc-card:hover{box-shadow:0 10px 24px rgba(17,24,39,.08);transform:translateY(-2px)}
.chc-img{position:relative;aspect-ratio:1;background:#f3f4f6}
.chc-img img{width:100%;height:100%;object-fit:cover;display:block}
.chc-badge{position:absolute;top:10px;left:10px;background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px}
.chc-body{padding:12px 14px 16px;display:flex;flex-direction:column;gap:6px}
.chc-body h3{font-size:14px;font-weight:600;margin:0;line-height:1.35}
.chc-price{font-size:15px;font-weight:700}
.chc-was{color:#9ca3af;text-decoration:line-through;font-weight:500;font-size:13px;margin-left:6px}
@media (max-width:640px){.chc-card{flex-basis:160px}.chc-nav{display:none}}
`;

export function CommerceCarousel({
  site,
  apiBase,
  placement = "article-footer",
  title = "Recommended Products",
  productUrl,
}: CommerceCarouselProps) {
  const [items, setItems] = useState<CarouselProduct[]>([]);
  const trackRef = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());
  const base = apiBase.replace(/\/$/, "");

  const track = useCallback(
    (eventType: string, p?: CarouselProduct) => {
      fetch(`${base}/v1/analytics`, {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          websiteSlug: site,
          productId: p?.id,
          eventType,
          placement,
          position: p?.position,
          sessionId: getSessionId(),
        }),
      }).catch(() => {});
    },
    [base, site, placement],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    seen.current.clear();
    fetch(`${base}/v1/carousels/${encodeURIComponent(site)}/${encodeURIComponent(placement)}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((d: { products?: CarouselProduct[] }) => {
        setItems(d.products ?? []);
        if (d.products?.length) track("CAROUSEL_LOAD");
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [base, site, placement, track]);

  // Count an impression only when a card is actually at least half visible.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !items.length || typeof IntersectionObserver === "undefined") return;
    const byId = new Map(items.map((p) => [p.id, p]));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.id;
          if (!e.isIntersecting || !id || seen.current.has(id)) continue;
          seen.current.add(id);
          io.unobserve(e.target);
          track("IMPRESSION", byId.get(id));
        }
      },
      { threshold: 0.5 },
    );
    el.querySelectorAll("[data-id]").forEach((card) => io.observe(card));
    return () => io.disconnect();
  }, [items, track]);

  if (!items.length) return null;
  const scroll = (dir: number) =>
    trackRef.current?.scrollBy({ left: dir * trackRef.current.clientWidth * 0.9 });

  return (
    <section className="chc" aria-label={title}>
      <style>{css}</style>
      <div className="chc-head">
        <h2>{title}</h2>
        <div className="chc-nav">
          <button type="button" aria-label="Previous" onClick={() => scroll(-1)}>
            &#8249;
          </button>
          <button type="button" aria-label="Next" onClick={() => scroll(1)}>
            &#8250;
          </button>
        </div>
      </div>
      <div className="chc-track" ref={trackRef}>
        {items.map((p) => {
          const onSale = !!p.compareAtPrice && p.compareAtPrice > p.price;
          const content = (
            <>
              <div className="chc-img">
                {p.imageUrl ? <img src={p.imageUrl} alt={p.title} loading="lazy" /> : null}
                {onSale ? <span className="chc-badge">Sale</span> : null}
              </div>
              <div className="chc-body">
                <h3>{p.title}</h3>
                <div className="chc-price">
                  {formatMoney(p.price, p.currency)}
                  {onSale ? (
                    <span className="chc-was">{formatMoney(p.compareAtPrice!, p.currency)}</span>
                  ) : null}
                </div>
              </div>
            </>
          );
          const href = productUrl?.(p);
          return href ? (
            <a
              key={p.id}
              data-id={p.id}
              className="chc-card"
              href={href}
              rel="sponsored noopener"
              onClick={() => track("CLICK", p)}
            >
              {content}
            </a>
          ) : (
            <div key={p.id} data-id={p.id} className="chc-card">
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}

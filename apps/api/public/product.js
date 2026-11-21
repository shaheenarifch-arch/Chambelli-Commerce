/*!
 * Chambelli product page and checkout-return page.
 *
 * Served with product.html at /{us|ca|uk|de}/p/{slug}?site={site-slug} (every carousel card links
 * here) and /{us|ca|uk|de}/checkout/return (where PayPal sends the shopper back after paying).
 */
(() => {
  const cfgEl = document.getElementById("chambelli-config");
  if (!cfgEl) return;
  const api = (cfgEl.dataset.api || "").replace(/\/$/, "");
  const market = cfgEl.dataset.market || "US";
  const app = document.getElementById("app");
  const notice = document.getElementById("mode-notice");
  const cartCount = document.getElementById("cart-count");
  const params = new URLSearchParams(location.search);
  const siteParam = params.get("site") || "";

  /** Address wording and country code per market. */
  const M = {
    US: { country: "US", region: "State", regionReq: true, postal: "ZIP code", postalEg: "02108" },
    CA: {
      country: "CA",
      region: "Province or territory",
      regionReq: true,
      postal: "Postal code",
      postalEg: "M5V 2T6",
    },
    UK: {
      country: "GB",
      region: "County (optional)",
      regionReq: false,
      postal: "Postcode",
      postalEg: "SW1A 1AA",
    },
    DE: {
      country: "DE",
      region: "Region (optional)",
      regionReq: false,
      postal: "Postcode",
      postalEg: "10115",
    },
  }[market] || {
    country: "US",
    region: "State",
    regionReq: true,
    postal: "ZIP code",
    postalEg: "02108",
  };

  /** Friendly wording for errors the API can return. */
  const ERRORS = {
    INSUFFICIENT_STOCK:
      "Sorry, there isn't enough stock of that option. Try fewer or another size.",
    INVENTORY_CHANGED:
      "Stock changed while you were shopping. Please add the item to your cart again.",
    INVALID_QUANTITY: "You can buy up to 20 of each item.",
    CART_NOT_ORDERABLE: "Your cart has already been checked out. Please add the item again.",
    INVALID_POSTAL_CODE: `Please check your ${M.postal.toLowerCase()}.`,
    INVALID_PROVINCE: "Please enter a valid Canadian province or territory.",
    SHIPPING_COUNTRY_NOT_SUPPORTED: "Sorry, we can't deliver to that country from this store.",
    PAYPAL_NOT_CONFIGURED: "Checkout isn't open yet. Please try again soon.",
    IDEMPOTENCY_KEY_REUSED:
      "Please use the same email as your first try, or add the item to your cart again.",
    PAYMENT_NOT_COMPLETED: "The payment wasn't completed. You have not been charged.",
  };
  const errText = (code) =>
    ERRORS[code] || "Something went wrong. Please try again, or email agents@getservices.ai.";

  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const safeImg = (u) => {
    try {
      const p = new URL(u, location.href);
      return p.protocol === "https:" || p.protocol === "http:" ? p.href : "";
    } catch {
      return "";
    }
  };
  const money = (amount, currency) => {
    try {
      return new Intl.NumberFormat(document.documentElement.lang || undefined, {
        style: "currency",
        currency,
      }).format(amount);
    } catch {
      return `${currency} ${Number(amount).toFixed(2)}`;
    }
  };
  const uuid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

  /** Browser storage can be missing or blocked; the page still works without it. */
  const store = {
    get(k) {
      try {
        return JSON.parse(localStorage.getItem(k) || "null");
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  };
  const cartKey = (siteId) => `chambelli-cart:${siteId}`;
  const LAST = `chambelli-last:${market}`;

  async function call(path, opts = {}) {
    const r = await fetch(`${api}${path}`, {
      ...opts,
      headers: opts.body ? { "content-type": "application/json" } : undefined,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 202) {
      const e = new Error(body.error || `HTTP_${r.status}`);
      e.code = body.error;
      throw e;
    }
    return { status: r.status, body };
  }

  function showMode(modes) {
    if (!modes || modes.paypal === "live") return;
    notice.hidden = false;
    if (modes.paypal === "sandbox") {
      notice.innerHTML =
        "<strong>Test mode:</strong> payments run in PayPal's sandbox, so no real money is charged " +
        "and no order ships. To try it, pay with a PayPal sandbox buyer account " +
        '(<a href="https://developer.paypal.com/tools/sandbox/" target="_blank" rel="noopener">what is the PayPal sandbox?</a>).';
    } else {
      notice.classList.add("warn");
      notice.innerHTML =
        "<strong>Checkout opens soon.</strong> You can browse and add to your cart, but payments " +
        'are not switched on yet. Questions: <a href="mailto:agents@getservices.ai">agents@getservices.ai</a>.';
    }
  }

  // ---------------------------------------------------------------- checkout return page
  if (/\/checkout\/return\/?$/.test(location.pathname)) {
    const last = store.get(LAST);
    const back = last?.url
      ? `<p><a href="${esc(last.url)}">Back to ${esc(last.title || "the product")}</a></p>`
      : "";
    if (params.get("cancelled")) {
      app.innerHTML = `<div class="panel"><h2>Payment cancelled</h2><p>You have not been charged and your cart is saved. You can try checkout again whenever you are ready.</p>${back}</div>`;
      return;
    }
    const token = params.get("token");
    if (!token) {
      app.innerHTML = `<div class="panel"><h2>No payment found</h2><p>We couldn't find a payment to confirm. If you were charged, email <a href="mailto:agents@getservices.ai">agents@getservices.ai</a> and we will sort it out.</p>${back}</div>`;
      return;
    }
    app.innerHTML = `<div class="panel"><h2>Confirming your payment…</h2><p>Please keep this page open.</p></div>`;
    call(`/v1/payments/paypal/${encodeURIComponent(token)}/capture`, { method: "POST" })
      .then(({ status, body }) => {
        if (last?.siteId) store.del(cartKey(last.siteId));
        const ref = esc(last?.orderNumber || body.orderId || "");
        app.innerHTML =
          status === 202
            ? `<div class="panel"><h2>Payment processing</h2><p>PayPal is still confirming your payment. We will email you as soon as it clears. Order: <strong>${ref}</strong></p></div>`
            : `<div class="panel"><h2>Thank you, your order is placed!</h2><p class="msg good">Order <strong>${ref}</strong> is confirmed. We will email you a tracking number once it ships.</p>${back}</div>`;
      })
      .catch((e) => {
        app.innerHTML = `<div class="panel"><h2>We couldn't confirm the payment</h2><p class="msg bad">${esc(errText(e.code))}</p>${back}</div>`;
      });
    return;
  }

  // ---------------------------------------------------------------- product page
  const slug = decodeURIComponent(location.pathname.split("/p/")[1] || "").replace(/\/$/, "");
  if (!slug) {
    app.innerHTML = "<p>Product not found.</p>";
    return;
  }
  const qs = new URLSearchParams({ market });
  if (siteParam) qs.set("site", siteParam);

  Promise.all([
    call(`/v1/products/${encodeURIComponent(slug)}?${qs}`),
    call("/v1/payments/status").catch(() => ({ body: null })),
  ])
    .then(([{ body: data }, { body: modes }]) => render(data, modes))
    .catch(() => {
      app.innerHTML = `<div class="panel"><h2>Product not found</h2><p>This product is no longer available. Browse more finds on the site you came from.</p></div>`;
    });

  function render(data, modes) {
    showMode(modes);
    const checkoutOpen = !!modes && modes.paypal !== "off";
    const { site, product, variants } = data;
    const buyable = variants.filter((v) => v.inStock);
    let state = store.get(cartKey(site.id)) || {};
    if (!state.sessionId) state = { sessionId: uuid() };
    const save = () => store.set(cartKey(site.id), state);

    // Germany-chapter sites can deliver to several EU countries (site.shipTo).
    const COUNTRY_NAMES = { DE: "Germany", FR: "France", PL: "Poland" };
    const POSTAL_EG = { DE: "10115", FR: "75001", PL: "00-950" };
    const shipTo = Array.isArray(site.shipTo) && site.shipTo.length ? site.shipTo : [M.country];
    const countryField =
      shipTo.length > 1
        ? `<div><label for="country">Country *</label><select id="country" autocomplete="country" required>${shipTo
            .map((c) => `<option value="${esc(c)}">${esc(COUNTRY_NAMES[c] || c)}</option>`)
            .join("")}</select>
              <p class="hint">We deliver to ${esc(shipTo.map((c) => COUNTRY_NAMES[c] || c).join(" and "))} only.</p></div>`
        : `<div><label>Country</label><p class="hint">Delivery to ${esc(COUNTRY_NAMES[shipTo[0]] || shipTo[0])} only.</p></div>`;
    const postalEg =
      shipTo
        .map((c) => POSTAL_EG[c])
        .filter(Boolean)
        .join(" or ") || M.postalEg;

    const optionLabel = variants.length > 1 ? "Size / option" : "Option";
    const options = variants
      .map(
        (v) =>
          `<option value="${esc(v.id)}"${v.inStock ? "" : " disabled"}>${esc(v.name)}${v.inStock ? "" : " (sold out)"}</option>`,
      )
      .join("");

    app.innerHTML = `
      <article class="product">
        <div class="photo">${product.imageUrl ? `<img src="${esc(safeImg(product.imageUrl))}" alt="${esc(product.title)}">` : ""}</div>
        <div>
          <h1>${esc(product.title)}</h1>
          <div id="price" class="price"></div>
          <p class="hint">Price in ${esc(site.currency)}, delivery included.</p>
          ${
            variants.length
              ? `<label for="variant">${optionLabel}</label>
                 <select id="variant">${options}</select>
                 <p class="hint">Choose your size or option. Sold-out options can't be picked.</p>`
              : ""
          }
          <label for="qty">Quantity</label>
          <input id="qty" class="qty" type="number" min="1" max="20" value="1" inputmode="numeric">
          <p class="hint">Up to 20 per item.</p>
          <div class="row">
            <button id="add" type="button"${buyable.length ? "" : " disabled"}>${buyable.length ? "Add to cart" : "Sold out"}</button>
            <button id="go" type="button" class="secondary" hidden>Checkout</button>
          </div>
          <p id="add-msg" class="msg" aria-live="polite"></p>
          ${product.description ? `<div class="desc">${esc(product.description)}</div>` : ""}
        </div>
      </article>

      <section id="checkout" class="panel" hidden aria-labelledby="co-title">
        <h2 id="co-title">Checkout</h2>
        <p class="hint">Enter where we should deliver, then you'll pay securely on PayPal (account or guest card). Fields marked * are required.</p>
        <form id="co-form" novalidate>
          <div class="grid2">
            <div><label for="email">Email *</label><input id="email" type="email" autocomplete="email" required maxlength="254">
              <p class="hint">For your receipt and tracking number.</p></div>
            <div><label for="name">Full name *</label><input id="name" autocomplete="name" required maxlength="200"></div>
            <div><label for="line1">Address line 1 *</label><input id="line1" autocomplete="address-line1" required maxlength="200"></div>
            <div><label for="line2">Address line 2</label><input id="line2" autocomplete="address-line2" maxlength="200">
              <p class="hint">Apartment, suite or unit (optional).</p></div>
            <div><label for="city">City *</label><input id="city" autocomplete="address-level2" required maxlength="100"></div>
            <div><label for="region">${esc(M.region)}${M.regionReq ? " *" : ""}</label><input id="region" autocomplete="address-level1" maxlength="100"${M.regionReq ? " required" : ""}></div>
            <div><label for="postal">${esc(M.postal)} *</label><input id="postal" autocomplete="postal-code" required maxlength="20" placeholder="e.g. ${esc(postalEg)}"></div>
            ${site.market === "DE" ? countryField : ""}
            <div><label for="phone">Phone</label><input id="phone" type="tel" autocomplete="tel" maxlength="40">
              <p class="hint">Optional, only used by the courier if there's a delivery problem.</p></div>
          </div>
          <div class="row">
            <button id="pay" type="submit"${checkoutOpen ? "" : " disabled"}>${
              modes?.paypal === "sandbox" ? "Pay with PayPal (test mode)" : "Pay with PayPal"
            }</button>
          </div>
          <p id="co-msg" class="msg" aria-live="polite"></p>
        </form>
      </section>`;

    const $ = (id) => document.getElementById(id);
    const sel = $("variant");
    const current = () => variants.find((v) => v.id === sel?.value) || buyable[0] || variants[0];
    if (sel && buyable[0]) sel.value = buyable[0].id;
    const showPrice = () => {
      const v = current();
      if (!v) return ($("price").textContent = "Currently unavailable");
      const sale = v.compareAtPrice && v.compareAtPrice > v.price;
      $("price").innerHTML =
        esc(money(v.price, v.currency)) +
        (sale
          ? `<span class="was">${esc(money(v.compareAtPrice, v.currency))}</span><span class="sale">Sale</span>`
          : "");
    };
    sel?.addEventListener("change", showPrice);
    showPrice();

    const showCart = (summary) => {
      const n = summary?.cart?.items?.reduce((s, i) => s + i.quantity, 0) || 0;
      cartCount.textContent = n
        ? `Cart: ${n} item${n > 1 ? "s" : ""} · ${money(summary.subtotal, site.currency)}`
        : "";
      $("go").hidden = !n;
      if (!n) $("checkout").hidden = true;
    };
    if (state.cartId)
      call(`/v1/cart/${encodeURIComponent(state.cartId)}`)
        .then(({ body }) => {
          if (body?.cart?.status && body.cart.status !== "ACTIVE") {
            state = { sessionId: uuid() };
            save();
            return showCart(null);
          }
          showCart(body);
        })
        .catch(() => showCart(null));

    /** Adds the chosen option; the API answers with the whole cart ({ cart, subtotal }). */
    const addToCart = async (retried) => {
      const v = current();
      const qty = Math.min(20, Math.max(1, parseInt($("qty").value, 10) || 1));
      try {
        const { body } = await call("/v1/cart/items", {
          method: "POST",
          body: JSON.stringify({
            sessionId: state.sessionId,
            websiteId: site.id,
            variantId: v.id,
            quantity: qty,
          }),
        });
        state.cartId = body.cart.id;
        save();
        return body;
      } catch (e) {
        // The saved cart was already checked out: start a fresh one, once.
        if (e.code === "CART_NOT_ORDERABLE" && !retried) {
          state = { sessionId: uuid() };
          save();
          return addToCart(true);
        }
        throw e;
      }
    };

    $("add").addEventListener("click", async () => {
      const btn = $("add");
      const msg = $("add-msg");
      btn.disabled = true;
      msg.className = "msg";
      msg.textContent = "Adding…";
      try {
        showCart(await addToCart(false));
        msg.className = "msg good";
        msg.textContent = "Added to cart. Press Checkout when you're ready.";
      } catch (e) {
        msg.className = "msg bad";
        msg.textContent = errText(e.code);
      }
      btn.disabled = false;
    });

    $("go").addEventListener("click", () => {
      $("checkout").hidden = false;
      $("checkout").scrollIntoView({ behavior: "smooth", block: "start" });
      $("email").focus();
    });

    $("co-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const msg = $("co-msg");
      const form = $("co-form");
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (!state.cartId) {
        msg.className = "msg bad";
        msg.textContent = "Your cart is empty. Add the item first.";
        return;
      }
      const val = (id) => $(id).value.trim() || undefined;
      // One key per cart: a retry (e.g. after cancelling on PayPal) reuses the same order.
      state.checkoutKey ||= `web-${uuid()}`;
      save();
      $("pay").disabled = true;
      msg.className = "msg";
      msg.textContent = "Taking you to PayPal…";
      try {
        const { body } = await call("/v1/checkout", {
          method: "POST",
          body: JSON.stringify({
            cartId: state.cartId,
            websiteId: site.id,
            customerEmail: val("email"),
            customerName: val("name"),
            address: {
              name: val("name"),
              line1: val("line1"),
              line2: val("line2"),
              city: val("city"),
              region: val("region"),
              postalCode: val("postal"),
              country: $("country") ? $("country").value : shipTo[0],
              phone: val("phone"),
            },
            paymentProvider: "PAYPAL",
            idempotencyKey: state.checkoutKey,
          }),
        });
        if (!body.approveUrl)
          throw Object.assign(new Error("NO_APPROVE_URL"), { code: "PAYPAL_NOT_CONFIGURED" });
        store.set(LAST, {
          url: location.href,
          title: product.title,
          siteId: site.id,
          orderNumber: body.orderNumber,
        });
        location.assign(body.approveUrl);
      } catch (e) {
        // This cart was already turned into an order: start a fresh cart for the next try.
        if (e.code === "CART_NOT_ORDERABLE") {
          state = { sessionId: uuid() };
          save();
          showCart(null);
        }
        msg.className = "msg bad";
        msg.textContent = errText(e.code);
        $("pay").disabled = false;
      }
    });
  }
})();

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
      region: "State (optional)",
      regionReq: false,
      postal: "Postcode (PLZ)",
      postalEg: "10115",
    },
  }[market] || {
    country: "US",
    region: "State",
    regionReq: true,
    postal: "ZIP code",
    postalEg: "02108",
  };

  /** Country name, postcode check and the tax row of the order summary, per market. */
  const MARKET_NAME =
    { US: "the US", CA: "Canada", UK: "the UK", DE: "Germany" }[market] || "the US";
  const POSTAL_RE = {
    US: /^\d{5}(-\d{4})?$/,
    CA: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,
    UK: /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/,
    DE: /^\d{5}$/,
  }[market];
  const TAX_ROW = {
    CA: ["GST/HST", "Added at payment"],
    UK: ["VAT", "Included"],
    DE: ["VAT", "Included"],
  }[market];
  /**
   * Expected arrival: 5 to 10 business days from today (the usual time for orders shipped from
   * CJ's local warehouses, the same promise ShopDress makes). Shown as dates, e.g. "Dec 1 to Dec 8".
   */
  const etaText = () => {
    const add = (days) => {
      const d = new Date();
      while (days > 0) {
        d.setDate(d.getDate() + 1);
        if (d.getDay() !== 0 && d.getDay() !== 6) days--;
      }
      return d;
    };
    try {
      const f = new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      return `${f.format(add(5))} to ${f.format(add(10))}`;
    } catch {
      return "in 5 to 10 business days";
    }
  };

  /** Friendly wording for errors the API can return. */
  const ERRORS = {
    INSUFFICIENT_STOCK:
      "Sorry, there isn't enough stock of that option. Try fewer or another size.",
    INVENTORY_CHANGED:
      "Stock changed while you were shopping. Please add the item to your cart again.",
    INVALID_QUANTITY: "You can buy up to 20 of each item.",
    CART_ITEM_NOT_FOUND: "That item is no longer in your cart.",
    CART_NOT_ORDERABLE: "Your cart has already been checked out. Please add the item again.",
    INVALID_POSTAL_CODE: `Please check your ${M.postal.toLowerCase()}.`,
    INVALID_PROVINCE: "Please enter a valid Canadian province or territory.",
    SHIPPING_COUNTRY_NOT_SUPPORTED: "Sorry, we can't deliver to that country from this store.",
    PAYPAL_NOT_CONFIGURED: "Checkout isn't open yet. Please try again soon.",
    STRIPE_NOT_CONFIGURED:
      "Card payments aren't available right now. Please try PayPal or try again soon.",
    IDEMPOTENCY_KEY_REUSED:
      "Please use the same email as your first try, or add the item to your cart again.",
    PAYMENT_NOT_COMPLETED: "The payment wasn't completed. You have not been charged.",
  };
  const US_STATES = "AL Alabama|AK Alaska|AZ Arizona|AR Arkansas|CA California|CO Colorado|CT Connecticut|DE Delaware|DC District of Columbia|FL Florida|GA Georgia|HI Hawaii|ID Idaho|IL Illinois|IN Indiana|IA Iowa|KS Kansas|KY Kentucky|LA Louisiana|ME Maine|MD Maryland|MA Massachusetts|MI Michigan|MN Minnesota|MS Mississippi|MO Missouri|MT Montana|NE Nebraska|NV Nevada|NH New Hampshire|NJ New Jersey|NM New Mexico|NY New York|NC North Carolina|ND North Dakota|OH Ohio|OK Oklahoma|OR Oregon|PA Pennsylvania|RI Rhode Island|SC South Carolina|SD South Dakota|TN Tennessee|TX Texas|UT Utah|VT Vermont|VA Virginia|WA Washington|WV West Virginia|WI Wisconsin|WY Wyoming"
    .split("|")
    .map((s) => [s.slice(0, 2), s.slice(3)]);
  const POSTAL_PATTERN = { US: "\\d{5}(-\\d{4})?" }[market] || "";
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
  const ADDR = `chambelli-address:${market}`;

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
    if (!modes || modes.paypal === "live" || modes.stripe === "live") return;
    notice.hidden = false;
    if (modes.paypal === "sandbox" || modes.stripe === "sandbox") {
      notice.innerHTML =
        "<strong>Test mode:</strong> payments run in test mode, so no real money is charged " +
        "and no order ships. Use a PayPal sandbox buyer account " +
        '(<a href="https://developer.paypal.com/tools/sandbox/" target="_blank" rel="noopener">PayPal sandbox help</a>) ' +
        'or a Stripe test card such as 4242 4242 4242 4242 (<a href="https://docs.stripe.com/testing" target="_blank" rel="noopener">Stripe test cards</a>).';
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
    // Card payments: Stripe sends the shopper back with the payment's client secret.
    const piSecret = params.get("payment_intent_client_secret");
    if (params.get("stripe") && piSecret) {
      app.innerHTML = `<div class="panel"><h2>Confirming your payment…</h2><p>Please keep this page open.</p></div>`;
      call("/v1/payments/status")
        .then(({ body: modes }) => loadStripe(modes?.stripePublishableKey))
        .then((stripe) => stripe.retrievePaymentIntent(piSecret))
        .then(({ paymentIntent }) => {
          const ref = esc(last?.orderNumber || "");
          const st = paymentIntent?.status;
          if (st === "succeeded" || st === "processing") {
            if (last?.siteId) store.del(cartKey(last.siteId));
            app.innerHTML =
              st === "succeeded"
                ? `<div class="panel"><h2>Thank you, your order is placed!</h2><p class="msg good">Order <strong>${ref}</strong> is confirmed. We will email you a tracking number once it ships.</p>${back}</div>`
                : `<div class="panel"><h2>Payment processing</h2><p>Your bank is still confirming the payment. We will email you as soon as it clears. Order: <strong>${ref}</strong></p></div>`;
          } else {
            app.innerHTML = `<div class="panel"><h2>The payment did not go through</h2><p class="msg bad">You have not been charged. Your cart is saved, so you can try again with another card or PayPal.</p>${back}</div>`;
          }
        })
        .catch(() => {
          app.innerHTML = `<div class="panel"><h2>We couldn't confirm the payment</h2><p>If you were charged, email <a href="mailto:agents@getservices.ai">agents@getservices.ai</a> and we will sort it out.</p>${back}</div>`;
        });
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
    const paypalOpen = !!modes && modes.paypal !== "off";
    const cardOpen = !!modes && modes.stripe !== "off" && !!modes.stripePublishableKey;
    const { site, product, variants } = data;
    const buyable = variants.filter((v) => v.inStock);
    let state = store.get(cartKey(site.id)) || {};
    if (!state.sessionId) state = { sessionId: uuid() };
    const save = () => store.set(cartKey(site.id), state);

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
            ${
              buyable.length && checkoutOpen
                ? `<button id="buy" type="button" class="buy">Buy now</button>`
                : ""
            }
            <button id="add" type="button"${buyable.length && checkoutOpen ? ' class="secondary"' : ""}${buyable.length ? "" : " disabled"}>${buyable.length ? "Add to cart" : "Sold out"}</button>
            <button id="go" type="button" class="secondary" hidden>Checkout</button>
          </div>
          <p id="add-msg" class="msg" aria-live="polite"></p>
          ${
            checkoutOpen
              ? `<ul class="perks"><li>Delivery included, no fees added at checkout</li><li>Pay with PayPal or any debit/credit card, no account needed</li><li>Tracking number by email once it ships</li></ul>`
              : `<p class="closed-note"><strong>Online payment isn't open yet</strong>, so you can't be charged. To order this item now, email <a href="mailto:agents@getservices.ai?subject=Order%3A%20${encodeURIComponent(product.title)}">agents@getservices.ai</a> and we will reply with a payment link.</p>`
          }
          ${product.description ? `<div class="desc">${esc(product.description)}</div>` : ""}
        </div>
      </article>

      <section id="checkout" class="checkout" hidden aria-labelledby="co-title">
        <h2 id="co-title">Checkout</h2>
        <p class="hint">Three quick steps. Fields marked * are required. Your order summary stays on screen, so you can change it before you pay.</p>
        <ol class="steps" aria-label="Checkout steps">
          <li id="st-1" class="on" aria-current="step">Delivery</li>
          <li id="st-2">Payment</li>
          <li id="st-3">Place order</li>
        </ol>
        <div class="co-grid">
          <div class="co-main">
            <div id="err-summary" class="err-summary" role="alert" tabindex="-1" hidden></div>
            <form id="co-form" novalidate>
              <section id="step-delivery" class="step-card current" aria-labelledby="h-delivery">
                <h3 id="h-delivery">1. Delivery <button type="button" class="edit" id="edit-delivery" hidden>Edit</button></h3>
                <p id="recap-delivery" class="recap" hidden></p>
                <div id="fields-delivery">
                  <p class="eta" id="eta"></p>
                  <div class="grid2">
                    <div><label for="email">Email *</label><input id="email" type="email" autocomplete="email" required maxlength="254" aria-describedby="email-hint">
                      <p class="hint" id="email-hint">For your receipt and tracking number.</p></div>
                    <div><label for="name">Full name *</label><input id="name" autocomplete="name" required maxlength="200"></div>
                    <div><label for="line1">Address line 1 *</label><input id="line1" autocomplete="address-line1" required maxlength="200"></div>
                    <div><label for="line2">Address line 2</label><input id="line2" autocomplete="address-line2" maxlength="200" aria-describedby="line2-hint">
                      <p class="hint" id="line2-hint">Apartment, suite or unit (optional).</p></div>
                    <div><label for="city">City *</label><input id="city" autocomplete="address-level2" required maxlength="100"></div>
                    <div><label for="region">${esc(M.region)}${M.regionReq ? " *" : ""}</label><input id="region" autocomplete="address-level1" maxlength="100"${M.regionReq ? " required" : ""}></div>
                    <div><label for="postal">${esc(M.postal)} *</label><input id="postal" autocomplete="postal-code" required maxlength="20" placeholder="${esc(M.postalEg)}"></div>
                    <div><label for="phone">Phone</label><input id="phone" type="tel" autocomplete="tel" maxlength="40" aria-describedby="phone-hint">
                      <p class="hint" id="phone-hint">Optional, only used by the courier if there's a delivery problem.</p></div>
                  </div>
                  <p class="hint">We deliver within ${esc(MARKET_NAME)} only.</p>
                  <div class="co-actions"><button id="to-pay" type="button">Continue to payment</button></div>
                </div>
              </section>

              <section id="step-pay" class="step-card" aria-labelledby="h-pay">
                <h3 id="h-pay">2. Payment <button type="button" class="edit" id="edit-pay" hidden>Edit</button></h3>
                <p id="recap-pay" class="recap" hidden></p>
                <div id="fields-pay" hidden>
                  <fieldset class="pay-choice">
                    <legend class="hint">Choose how to pay.</legend>
                    <label class="pay-tile${cardOpen ? "" : " off"}"><input type="radio" name="pay" value="STRIPE"${cardOpen ? " checked" : " disabled"}>
                      <span>${modes?.stripe === "sandbox" ? "Card (test mode)" : "Card"}<small>${cardOpen ? "Visa, Mastercard, Amex. Apple Pay and Google Pay show up when your device offers them." : "Card payments aren't available right now."}</small></span></label>
                    <label class="pay-tile${paypalOpen ? "" : " off"}"><input type="radio" name="pay" value="PAYPAL"${!cardOpen && paypalOpen ? " checked" : ""}${paypalOpen ? "" : " disabled"}>
                      <span>${modes?.paypal === "sandbox" ? "PayPal (test mode)" : "PayPal"}<small>Pay with your PayPal account, or as a guest with a card on PayPal's page.</small></span></label>
                  </fieldset>
                  <div class="co-actions"><button id="pay" type="submit"${cardOpen || paypalOpen ? "" : " disabled"}>Continue</button></div>
                  <ul class="trust">
                    <li>Secure checkout: card details go straight to ${cardOpen ? "Stripe or PayPal" : "PayPal"}, never to us.</li>
                    <li>Delivery is included in the price.</li>
                    <li>Questions or returns? See <a href="#help-title">Help &amp; questions</a> below.</li>
                  </ul>
                </div>
              </section>
            </form>

            <section id="step-place" class="step-card" aria-labelledby="h-place">
              <h3 id="h-place">3. Place order</h3>
              <div id="card-box" hidden>
                <p class="hint">Enter your card below. Your bank may ask you to confirm the payment. <a href="https://support.stripe.com/" target="_blank" rel="noopener">Stripe Support</a></p>
                <div id="card-element"></div>
                <div class="co-actions"><button id="card-pay" type="button">Place order</button></div>
                <p id="card-msg" class="msg" aria-live="polite"></p>
              </div>
            </section>
            <p id="co-msg" class="msg" aria-live="polite"></p>
          </div>

          <aside class="co-side" aria-label="Order summary">
            <details id="summary" class="summary">
              <summary><span>Order summary <span id="sum-count"></span></span><span><strong id="sum-total"></strong> <span class="chev" aria-hidden="true">&#9662;</span></span></summary>
              <div class="summary-body">
                <div id="sum-lines"></div>
                <p id="sum-msg" class="msg" aria-live="polite"></p>
                <dl class="totals" id="sum-totals"></dl>
                <div id="addons" class="addons" hidden>
                  <h3>Add before you pay</h3>
                  <p class="hint">Last-minute extras from this shop. One tap adds it to this same order.</p>
                  <div id="addon-row" class="addon-row"></div>
                  <p id="addon-msg" class="msg" aria-live="polite"></p>
                </div>
              </div>
            </details>
          </aside>
        </div>
      </section>

      <section id="related" class="panel" hidden aria-labelledby="rel-title">
        <h2 id="rel-title">You may also like</h2>
        <p class="hint">More from this shop. Tap a product to see it, or use the arrows to browse.</p>
        <div class="rel-wrap">
          <button type="button" class="rel-arrow prev" aria-label="Previous products">&#8249;</button>
          <div id="rel-row" class="rel-row"></div>
          <button type="button" class="rel-arrow next" aria-label="More products">&#8250;</button>
        </div>
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

    let lastSummary = null;
    let locked = false; // true once the order exists: the summary can no longer change
    const showCart = (summary) => {
      lastSummary = summary;
      const n = summary?.cart?.items?.reduce((s, i) => s + i.quantity, 0) || 0;
      cartCount.textContent = n
        ? `Cart: ${n} item${n > 1 ? "s" : ""} · ${money(summary.subtotal, site.currency)}`
        : "";
      $("go").hidden = !n;
      if (!n) $("checkout").hidden = true;
      renderSummary(summary);
    };

    /** The order summary: photos, quantity, Remove, delivery, tax and total. */
    function renderSummary(summary, order) {
      const lines = summary?.lines || [];
      const n = lines.reduce((s, l) => s + l.quantity, 0);
      const total = order ? order.total : summary?.subtotal || 0;
      $("sum-count").textContent = n ? `(${n} item${n > 1 ? "s" : ""})` : "";
      $("sum-total").textContent = money(total, site.currency);
      $("sum-lines").innerHTML = lines
        .map(
          (l) => `<div class="line" data-v="${esc(l.variantId)}">
            ${l.imageUrl ? `<img src="${esc(safeImg(l.imageUrl))}" alt="" loading="lazy">` : "<span></span>"}
            <div><div class="t">${esc(l.title)}</div>
              ${l.option ? `<div class="o">${esc(l.option)}</div>` : ""}
              ${
                locked
                  ? `<div class="o">Qty ${l.quantity}</div>`
                  : `<span class="stepper"><button type="button" data-q="-1" aria-label="One fewer ${esc(l.title)}">&minus;</button><span aria-live="polite">${l.quantity}</span><button type="button" data-q="1" aria-label="One more ${esc(l.title)}"${l.quantity >= (l.maxQuantity || 20) ? " disabled" : ""}>+</button></span><button type="button" class="rm" data-rm="1">Remove</button>`
              }</div>
            <div class="lt">${esc(money(l.lineTotal, site.currency))}</div></div>`,
        )
        .join("");
      const rows = [
        ["Subtotal", money(summary?.subtotal || 0, site.currency)],
        ["Delivery", '<span class="free">Included</span>'],
      ];
      if (TAX_ROW)
        rows.push([
          TAX_ROW[0],
          order && market === "CA"
            ? money(order.total - (summary?.subtotal || 0), site.currency)
            : TAX_ROW[1],
        ]);
      $("sum-totals").innerHTML =
        rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("") +
        `<dt class="grand">${order || market !== "CA" ? "Total" : "Estimated total"}</dt><dd class="grand">${esc(money(total, site.currency))}</dd>`;
      payLabel();
    }

    /** Quantity buttons and Remove in the order summary. */
    $("sum-lines").addEventListener("click", async (ev) => {
      const btn = ev.target.closest("button");
      const row = ev.target.closest(".line");
      if (!btn || !row || locked || !state.cartId) return;
      const line = (lastSummary?.lines || []).find((l) => l.variantId === row.dataset.v);
      if (!line) return;
      const quantity = btn.dataset.rm ? 0 : line.quantity + Number(btn.dataset.q || 0);
      const msg = $("sum-msg");
      row.querySelectorAll("button").forEach((b) => (b.disabled = true));
      msg.className = "msg";
      msg.textContent = "Updating…";
      try {
        const { body } = await call(
          `/v1/cart/${encodeURIComponent(state.cartId)}/items/${encodeURIComponent(line.variantId)}`,
          { method: "POST", body: JSON.stringify({ quantity }) },
        );
        msg.textContent = quantity ? "" : `Removed "${line.title.slice(0, 60)}".`;
        showCart(body);
      } catch (e) {
        msg.className = "msg bad";
        msg.textContent = errText(e.code);
        row.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    });

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

    /**
     * Adds the chosen option (or, for a last-minute add-on, the given variant and quantity);
     * the API answers with the whole cart ({ cart, subtotal }).
     */
    const addToCart = async (retried, item) => {
      const v = item ? { id: item.variantId } : current();
      const qty = item
        ? item.quantity
        : Math.min(20, Math.max(1, parseInt($("qty").value, 10) || 1));
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
          return addToCart(true, item);
        }
        throw e;
      }
    };

    // ------------------------------------------------ related items + last-minute add-ons
    // Both come from this site's Chambelli feed (the same products as the site's carousel).
    const marketPath = location.pathname.split("/p/")[0];
    const productLink = (p) =>
      `${marketPath}/p/${encodeURIComponent(p.slug)}?site=${encodeURIComponent(site.slug)}`;
    const cardImg = (p) =>
      p.imageUrl ? `<img src="${esc(safeImg(p.imageUrl))}" alt="" loading="lazy">` : "";
    call(`/v1/carousels/${encodeURIComponent(site.slug)}/article-footer`)
      .then(({ body }) => {
        const others = (body?.products || []).filter(
          (p) => p.slug !== product.slug && p.currency === site.currency,
        );
        if (!others.length) return;

        $("rel-row").innerHTML = others
          .slice(0, 16)
          .map(
            (p) => `<a class="rel-card" href="${esc(productLink(p))}">${cardImg(p)}
              <span class="t">${esc(p.title)}</span>
              <span class="p">${esc(money(p.price, p.currency))}</span></a>`,
          )
          .join("");
        $("related").hidden = false;
        const row = $("rel-row");
        const step = () => Math.max(180, row.clientWidth * 0.8);
        document
          .querySelector(".rel-arrow.prev")
          .addEventListener("click", () => row.scrollBy({ left: -step(), behavior: "smooth" }));
        document
          .querySelector(".rel-arrow.next")
          .addEventListener("click", () => row.scrollBy({ left: step(), behavior: "smooth" }));

        // Add-ons: the 4 lowest-priced other products, easy to add without leaving checkout.
        const addons = [...others].sort((a, b) => a.price - b.price).slice(0, 4);
        $("addon-row").innerHTML = addons
          .map(
            (p, i) => `<div class="addon-card">${cardImg(p)}
              <span class="t">${esc(p.title)}</span>
              <span class="p">${esc(money(p.price, p.currency))}</span>
              <button type="button" class="secondary" data-i="${i}">Add</button></div>`,
          )
          .join("");
        $("addons").hidden = false;
        $("addon-row").addEventListener("click", async (ev) => {
          const btn = ev.target.closest("button[data-i]");
          if (!btn) return;
          const p = addons[Number(btn.dataset.i)];
          const msg = $("addon-msg");
          btn.disabled = true;
          msg.className = "msg";
          msg.textContent = "Adding…";
          try {
            showCart(await addToCart(false, { variantId: p.variantId, quantity: 1 }));
            btn.textContent = "Added ✓";
            msg.className = "msg good";
            msg.textContent = `Added "${p.title.slice(0, 60)}" to your order.`;
          } catch (e) {
            btn.disabled = false;
            msg.className = "msg bad";
            msg.textContent = errText(e.code);
          }
        });
      })
      .catch(() => {
        /* no related items: the page works without them */
      });

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

    // ------------------------------------------------------------------ checkout steps
    // Step 1 Delivery -> step 2 Payment -> step 3 Place order. Steps 1 and 2 fold into one-line
    // recaps with Edit links until the order is created; after that they are locked.
    $("eta").textContent = `Delivery included. Usually arrives ${etaText()}.`;
    const wide = window.matchMedia ? window.matchMedia("(min-width: 901px)") : { matches: true };
    $("summary").open = wide.matches;

    function setStep(n) {
      [1, 2, 3].forEach((i) => {
        const li = $(`st-${i}`);
        li.className = i < n ? "done" : i === n ? "on" : "";
        if (i === n) li.setAttribute("aria-current", "step");
        else li.removeAttribute("aria-current");
      });
      $("step-delivery").classList.toggle("current", n === 1);
      $("step-pay").classList.toggle("current", n === 2);
      $("step-place").classList.toggle("current", n === 3);
      $("fields-delivery").hidden = n !== 1;
      $("recap-delivery").hidden = n === 1;
      $("edit-delivery").hidden = n === 1 || locked;
      $("fields-pay").hidden = n !== 2;
      $("recap-pay").hidden = n !== 3;
      $("edit-pay").hidden = n !== 3 || locked;
    }

    $("go").addEventListener("click", () => {
      $("checkout").hidden = false;
      setStep(1);
      $("checkout").scrollIntoView({ behavior: "smooth", block: "start" });
      const first = ["email", "name", "line1", "city", "region", "postal"].find((id) => !$(id).value);
      $(first || "pay").focus({ preventScroll: true });
    };
    $("go").addEventListener("click", openCheckout);

    $("buy")?.addEventListener("click", async () => {
      const btn = $("buy");
      const msg = $("add-msg");
      btn.disabled = true;
      msg.className = "msg";
      msg.textContent = "One moment…";
      try {
        showCart(await addToCart(false));
        msg.textContent = "";
        openCheckout();
      } catch (e) {
        msg.className = "msg bad";
        msg.textContent = errText(e.code);
      }
      btn.disabled = false;
    });

    $("more-addr").addEventListener("click", () => {
      $("more-addr").hidden = true;
      $("line2").hidden = false;
      $("line2").focus();
    });
    $("edit-delivery").addEventListener("click", () => {
      setStep(1);
      $("email").focus();
    });
    $("edit-pay").addEventListener("click", () => setStep(2));

    /** Checks the delivery fields; shows each problem under its field and in a list at the top. */
    const FIELD_NAMES = {
      email: "Email",
      name: "Full name",
      line1: "Address line 1",
      city: "City",
      region: M.region.replace(" (optional)", ""),
      postal: M.postal,
    };
    function checkDelivery() {
      const problems = [];
      for (const id of Object.keys(FIELD_NAMES)) {
        const el = $(id);
        const v = el.value.trim();
        let err = "";
        if (el.required && !v) err = `Enter your ${FIELD_NAMES[id].toLowerCase()}.`;
        else if (id === "email" && v && !el.checkValidity())
          err = "Enter an email like name@example.com.";
        else if (id === "postal" && v && POSTAL_RE && !POSTAL_RE.test(v))
          err = `Check your ${M.postal.toLowerCase()}, for example ${M.postalEg}.`;
        fieldError(el, err);
        if (err) problems.push({ id, err });
      }
      const box = $("err-summary");
      if (!problems.length) {
        box.hidden = true;
        return true;
      }
      box.innerHTML =
        `<strong>Please fix ${problems.length === 1 ? "this" : `these ${problems.length} things`} to continue:</strong><ul>` +
        problems.map((p) => `<li><a href="#${p.id}">${esc(p.err)}</a></li>`).join("") +
        "</ul>";
      box.hidden = false;
      box.focus();
      return false;
    }
    function fieldError(el, err) {
      const id = `${el.id}-err`;
      let p = document.getElementById(id);
      if (!err) {
        el.removeAttribute("aria-invalid");
        p?.remove();
        return;
      }
      if (!p) {
        p = document.createElement("p");
        p.id = id;
        p.className = "err";
        el.insertAdjacentElement("afterend", p);
      }
      p.textContent = err;
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-errormessage", id);
    }
    $("err-summary").addEventListener("click", (ev) => {
      const a = ev.target.closest("a[href^='#']");
      if (!a) return;
      ev.preventDefault();
      $(a.getAttribute("href").slice(1))?.focus();
    });
    ["email", "name", "line1", "city", "region", "postal"].forEach((id) =>
      $(id).addEventListener("input", () => fieldError($(id), "")),
    );

    $("to-pay").addEventListener("click", () => {
      if (!checkDelivery()) return;
      const val = (id) => $(id).value.trim();
      $("recap-delivery").textContent = [
        val("name"),
        [val("line1"), val("line2")].filter(Boolean).join(", "),
        [val("city"), val("region"), val("postal")].filter(Boolean).join(" "),
        val("email"),
      ]
        .filter(Boolean)
        .join(" · ");
      setStep(2);
      $("h-pay").scrollIntoView({ behavior: "smooth", block: "start" });
    });

    function provider() {
      return document.querySelector('input[name="pay"]:checked')?.value === "STRIPE"
        ? "STRIPE"
        : "PAYPAL";
    }
    function payLabel() {
      const total = money(lastSummary?.subtotal || 0, site.currency);
      const est = market === "CA" ? " + tax" : "";
      $("pay").textContent =
        provider() === "STRIPE"
          ? `Continue to card payment · ${total}${est}`
          : `Continue to PayPal · ${total}${est}`;
    }
    document
      .querySelectorAll('input[name="pay"]')
      .forEach((r) => r.addEventListener("change", payLabel));
    payLabel();

    $("co-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const msg = $("co-msg");
      // Enter pressed in a delivery field: go to the payment step, don't start paying yet.
      if ($("fields-pay").hidden) {
        $("to-pay").click();
        return;
      }
      if (!checkDelivery()) {
        setStep(1);
        return;
      }
      if (!state.cartId || !lastSummary?.lines?.length) {
        msg.className = "msg bad";
        msg.textContent = "Your cart is empty. Add the item first.";
        return;
      }
      const val = (id) => $(id).value.trim() || undefined;
      const chosen = provider();
      // One key per cart: a retry (e.g. after cancelling on PayPal) reuses the same order.
      state.checkoutKey ||= `web-${uuid()}`;
      save();
      const payBtn = $("pay");
      payBtn.disabled = true;
      msg.className = "msg";
      msg.textContent = chosen === "STRIPE" ? "Preparing the card form…" : "Taking you to PayPal…";
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
              country: M.country,
              phone: val("phone"),
            },
            paymentProvider: chosen,
            idempotencyKey: state.checkoutKey,
          }),
        });
        store.set(LAST, {
          url: location.href,
          title: product.title,
          siteId: site.id,
          orderNumber: body.orderNumber,
        });
        // The order now exists: lock the summary and show the real total (with tax in Canada).
        locked = true;
        renderSummary(lastSummary, body);
        $("addons").hidden = true;
        if (chosen === "STRIPE") {
          if (!body.clientSecret)
            throw Object.assign(new Error("NO_CLIENT_SECRET"), { code: "STRIPE_NOT_CONFIGURED" });
          $("recap-pay").textContent = `Card · order ${body.orderNumber}`;
          setStep(3);
          await showCardForm(body, val("email"));
          msg.textContent = "";
          return;
        }
        if (!body.approveUrl)
          throw Object.assign(new Error("NO_APPROVE_URL"), { code: "PAYPAL_NOT_CONFIGURED" });
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
        payBtn.disabled = false;
      }
    });

    /** Shows Stripe's secure card form for this order (step 3), then confirms the payment. */
    async function showCardForm(order, email) {
      const stripe = await loadStripe(modes.stripePublishableKey);
      // Stripe's form in Chambelli's colors. Help: https://docs.stripe.com/elements/appearance-api
      const elements = stripe.elements({
        clientSecret: order.clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#534ab7",
            colorText: "#26215c",
            colorDanger: "#a32d2d",
            borderRadius: "8px",
          },
        },
      });
      const card = elements.create("payment", { layout: "tabs" });
      $("card-box").hidden = false;
      card.mount("#card-element");
      $("card-pay").textContent = `Place order · ${money(order.total, order.currency)}`;
      $("step-place").scrollIntoView({ behavior: "smooth", block: "start" });
      $("card-pay").onclick = async () => {
        const cmsg = $("card-msg");
        $("card-pay").disabled = true;
        cmsg.className = "msg";
        cmsg.textContent = "Processing your payment…";
        const { error } = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: `${location.origin}${marketPath}/checkout/return?stripe=1`,
            receipt_email: email,
          },
        });
        // confirmPayment only returns here when the payment could not go through.
        cmsg.className = "msg bad";
        cmsg.textContent = error?.message || "The payment did not go through. Please try again.";
        $("card-pay").disabled = false;
      };
    }
  }

  /** Loads Stripe.js once (https://docs.stripe.com/js). */
  function loadStripe(publishableKey) {
    if (!publishableKey)
      return Promise.reject(Object.assign(new Error("NO_KEY"), { code: "STRIPE_NOT_CONFIGURED" }));
    if (window.Stripe) return Promise.resolve(window.Stripe(publishableKey));
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://js.stripe.com/v3/";
      s.onload = () => resolve(window.Stripe(publishableKey));
      s.onerror = () =>
        reject(Object.assign(new Error("STRIPE_LOAD"), { code: "STRIPE_NOT_CONFIGURED" }));
      document.head.appendChild(s);
    });
  }
})();

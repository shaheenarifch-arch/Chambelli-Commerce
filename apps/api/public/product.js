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
    STRIPE_NOT_CONFIGURED:
      "Card payments aren't available right now. Please try PayPal or try again soon.",
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
            <button id="add" type="button"${buyable.length ? "" : " disabled"}>${buyable.length ? "Add to cart" : "Sold out"}</button>
            <button id="go" type="button" class="secondary" hidden>Checkout</button>
          </div>
          <p id="add-msg" class="msg" aria-live="polite"></p>
          ${product.description ? `<div class="desc">${esc(product.description)}</div>` : ""}
        </div>
      </article>

      <section id="checkout" class="panel" hidden aria-labelledby="co-title">
        <h2 id="co-title">Checkout</h2>
        <div id="addons" class="addons" hidden>
          <h3>Add before you pay</h3>
          <p class="hint">Last-minute extras from this shop. One tap adds it to this same order.</p>
          <div id="addon-row" class="addon-row"></div>
          <p id="addon-msg" class="msg" aria-live="polite"></p>
        </div>
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
            <div><label for="postal">${esc(M.postal)} *</label><input id="postal" autocomplete="postal-code" required maxlength="20" placeholder="e.g. ${esc(M.postalEg)}"></div>
            <div><label for="phone">Phone</label><input id="phone" type="tel" autocomplete="tel" maxlength="40">
              <p class="hint">Optional, only used by the courier if there's a delivery problem.</p></div>
          </div>
          <div class="row">
            ${
              cardOpen
                ? `<button id="pay-card" type="submit" value="STRIPE">${
                    modes.stripe === "sandbox" ? "Pay by card (test mode)" : "Pay by card"
                  }</button>`
                : ""
            }
            <button id="pay" type="submit" value="PAYPAL" class="${cardOpen ? "secondary" : ""}"${
              paypalOpen ? "" : " disabled"
            }>${modes?.paypal === "sandbox" ? "Pay with PayPal (test mode)" : "Pay with PayPal"}</button>
          </div>
          <p class="hint">${
            cardOpen
              ? "Card payments are handled by Stripe and PayPal payments by PayPal; we never see your card number."
              : "PayPal lets you pay with your PayPal account or as a guest with a card."
          }</p>
          <p id="co-msg" class="msg" aria-live="polite"></p>
        </form>
        <div id="card-box" hidden>
          <h3>Card details</h3>
          <p class="hint">Enter your card below. Your bank may ask you to confirm the payment.</p>
          <div id="card-element"></div>
          <div class="row"><button id="card-pay" type="button">Pay now</button></div>
          <p id="card-msg" class="msg" aria-live="polite"></p>
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
      const provider = ev.submitter?.value === "STRIPE" ? "STRIPE" : "PAYPAL";
      // One key per cart: a retry (e.g. after cancelling on PayPal) reuses the same order.
      state.checkoutKey ||= `web-${uuid()}`;
      save();
      const payButtons = [$("pay"), $("pay-card")].filter(Boolean);
      payButtons.forEach((b) => (b.disabled = true));
      msg.className = "msg";
      msg.textContent =
        provider === "STRIPE" ? "Preparing the card form…" : "Taking you to PayPal…";
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
            paymentProvider: provider,
            idempotencyKey: state.checkoutKey,
          }),
        });
        store.set(LAST, {
          url: location.href,
          title: product.title,
          siteId: site.id,
          orderNumber: body.orderNumber,
        });
        if (provider === "STRIPE") {
          if (!body.clientSecret)
            throw Object.assign(new Error("NO_CLIENT_SECRET"), { code: "STRIPE_NOT_CONFIGURED" });
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
        payButtons.forEach((b) => (b.disabled = false));
        if (!paypalOpen) $("pay").disabled = true;
      }
    });

    /** Shows Stripe's secure card form for this order, then confirms the payment. */
    async function showCardForm(order, email) {
      const stripe = await loadStripe(modes.stripePublishableKey);
      const elements = stripe.elements({ clientSecret: order.clientSecret });
      const card = elements.create("payment", { layout: "tabs" });
      $("card-box").hidden = false;
      $("co-form").hidden = true;
      card.mount("#card-element");
      $("card-pay").textContent = `Pay ${money(order.total, order.currency)} now`;
      $("card-box").scrollIntoView({ behavior: "smooth", block: "start" });
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

# Chambelli Germany chapter

Sells CJ products held in **German (DE) warehouses** to shoppers in Germany, priced in **EUR** with
delivery in Germany built in. Checkout runs in Chambelli itself. Built the same way as the
[UK chapter](UK.md).

Germany sites (both moved here from the UK chapter):

| Site                                         | Slug           | Sells                                                     |
| -------------------------------------------- | -------------- | --------------------------------------------------------- |
| [buybeststore.com](https://buybeststore.com) | `buybeststore` | Best buys across home, kitchen, beauty, tech, garden      |
| [jewllery.store](https://jewllery.store)     | `jewllery`     | Jewellery: necklaces, earrings, bracelets, rings, watches |

Each site has the Chambelli carousel at the top of its homepage; it hides itself until you approve
products.

## 1. Turn on the Germany sync

Add these to `/etc/chambelli/env` on the server, then recreate the worker:

| Setting                    | What it does                                                                                                                                           | Example |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `CJ_SYNC_DE`               | Turns the Germany pass on (runs after the main 6-hourly CJ sync and the UK pass)                                                                       | `true`  |
| `USD_TO_EUR_RATE`          | Converts CJ's USD cost to EUR. Update it when the rate moves                                                                                           | `0.92`  |
| `DE_SHIPPING_ESTIMATE_EUR` | Average CJ delivery cost inside Germany, built into every price                                                                                        | `4.00`  |
| `DE_MIN_MARGIN_PERCENT`    | Minimum margin before VAT                                                                                                                              | `30`    |
| `DE_VAT_PERCENT`           | VAT added to prices. Keep `0` until you are registered for EU VAT, then `19` ([EU VAT One-Stop Shop](https://vat-one-stop-shop.ec.europa.eu/index_en)) | `0`     |

Each synced product gets a `<sku>-DE` variant (EUR, warehouse DE) and the tag `de`. New products stay
**drafts** until you approve them.

Price = (CJ cost × rate + German delivery) ÷ (1 − margin), then + VAT if set.
Example: $10 cost × 0.92 = €9.20 + €4.00 delivery = €13.20 ÷ 0.70 = **€18.86**, shown as €18.99.

CJ allows one request per second, so the Germany pass is slow on purpose (about 1 second per product).

## 2. Germany sites (market "DE")

In `config/cj-site-map.json`, give a site `"market": "DE"`. The next sync then:

- sets the site to **market DE, currency EUR**, so its carousel shows **€** prices;
- drops any links to products that are not from the Germany sync (this clears the UK products
  buybeststore.com and jewllery.store had before);
- links it only products from the Germany sync (tag `de`), filtered by its `titleMatch` words
  (Germany sites need `titleMatch`, because these products have no CJ category);
- keeps each EUR price in step with CJ's German warehouse stock every 6 hours.

Products with US, UK or AU plugs are kept off buybeststore.com (`titleExclude`); EU plugs are fine.

**Approving** a Germany site in the hub (Carousels page) prices each product in EUR from its CJ cost
(30% margin + German delivery + VAT if set) and checks CJ's German stock. Products with no German
stock stay waiting. If you see "set USD_TO_EUR_RATE and DE_SHIPPING_ESTIMATE_EUR", add those to the
server env first. Approve **one site at a time**.

## 3. Checkout in EUR

Germany sites check out through Chambelli's own API (`/v1/cart/items`, `/v1/checkout`), charged in
**EUR** with Stripe or PayPal (both support EUR):

- delivery addresses in Germany only (country `DE`);
- the postcode must be five digits (Postleitzahl, e.g. `10115`; `D-10115` is accepted);
- nothing is added at checkout: delivery and any VAT are already in the price.

**Keep PayPal on sandbox for Germany until EU VAT is sorted** (see below): `PAYPAL_BASE_URL` must
point at `api-m.sandbox.paypal.com`. The product page shows a test-mode notice while it is.

**Chambelli Germany storefront page:** run `pnpm db:de` once (creates the `chambelli-de` site and
its storefront carousel), then open `/de` on the API. On the VM, add `/de` to the `@api` line in
`/etc/caddy/conf.d/chambelli.caddy` (the install script now does this) and reload Caddy.

## 4. Before selling for real (not tax advice)

- **EU VAT:** a seller outside the EU selling goods to EU consumers from stock inside the EU usually
  has to register for VAT. Your UK VAT registration does not cover the EU. Start at the
  [EU VAT One-Stop Shop](https://vat-one-stop-shop.ec.europa.eu/index_en) and the
  [German Federal Central Tax Office (BZSt)](https://www.bzst.de/EN/Home/home_node.html). When
  registered, set `DE_VAT_PERCENT=19`.
- **Impressum (legal notice):** German law requires sites aimed at Germany to show the provider's
  name, **postal address**, email and phone. buybeststore.com and jewllery.store each need an
  Impressum page with these.
  Help: [Your Europe: information you must give customers](https://europa.eu/youreurope/business/dealing-with-customers/consumer-contracts-guarantees/consumer-contracts/index_en.htm).
- **Packaging register (LUCID):** sellers shipping packaged goods to German consumers generally must
  register with the [Central Agency Packaging Register](https://lucid.verpackungsregister.org/).
  Check whether CJ covers this for its German warehouse before going live.

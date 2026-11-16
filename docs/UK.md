# Chambelli UK chapter

Sells CJ products held in **UK (GB) warehouses** to UK shoppers, priced in **GBP** with UK delivery built in.
Checkout runs in Chambelli itself (not Fashtronix Hub). Modelled on the Canada chapter.

## 1. Turn on the UK sync

Add these to `/etc/chambelli/env` on the server, then recreate the worker:

| Setting                    | What it does                                                                                                            | Example |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------- |
| `CJ_SYNC_UK`               | Turns the UK pass on (runs after the main 6-hourly CJ sync)                                                             | `true`  |
| `USD_TO_GBP_RATE`          | Converts CJ's USD cost to GBP. Update it when the rate moves                                                            | `0.79`  |
| `UK_SHIPPING_ESTIMATE_GBP` | Average CJ delivery cost inside the UK, built into every price                                                          | `3.50`  |
| `UK_MIN_MARGIN_PERCENT`    | Minimum margin before VAT                                                                                               | `30`    |
| `UK_VAT_PERCENT`           | VAT added to prices. Keep `0` until VAT-registered, then `20` ([when to register](https://www.gov.uk/vat-registration)) | `0`     |

Each synced product gets a `<sku>-UK` variant (GBP, warehouse GB) and the tag `uk`. New products stay
**drafts** until you approve them.

Price = (CJ cost × rate + UK shipping) ÷ (1 − margin), then + VAT if set.
Example: $10 cost × 0.80 = £8.00 + £4.00 shipping = £12.00 ÷ 0.70 = **£17.15**.

CJ allows one request per second, so the UK pass is slow on purpose (about 1 second per product).

## 2. UK sites (market "UK")

In `config/cj-site-map.json`, give a site `"market": "UK"`. The next sync then:

- sets the site to **market UK, currency GBP**, so its carousel shows **£** prices;
- links it only products from the UK sync (tag `uk`), filtered by its `titleMatch` words
  (UK sites need `titleMatch`, because UK products have no CJ category);
- keeps each UK price in step with CJ's UK warehouse stock every 6 hours.

**Approving** a UK site in the hub (Carousels page) prices each product in GBP from its CJ cost
(30% margin + UK shipping + VAT if set) and checks CJ's UK stock. Products with no UK stock stay
waiting. If you see "set USD_TO_GBP_RATE and UK_SHIPPING_ESTIMATE_GBP", add those to the server env
first. CJ allows about one request per second, so approve **one site at a time**.

## 3. Checkout in GBP (Chambelli's own, not Fashtronix Hub)

UK sites check out through Chambelli's own API (`/v1/cart/items`, `/v1/checkout`), charged in **GBP**
with Stripe or PayPal:

- UK delivery addresses only (country `GB`; `UK` is accepted and changed to `GB`);
- the postcode must be valid and is saved as `SW1A 1AA` style;
- nothing is added at checkout: delivery and any VAT are already in the price.

**Chambelli UK storefront page:** run `pnpm db:uk` once (creates the `chambelli-uk` site and its
storefront carousel), then open `/uk` on the API. On the VM, add `/uk` to the `@api` line in
`/etc/caddy/conf.d/chambelli.caddy` (the install script now does this) and reload Caddy.

Card payments need `STRIPE_SECRET_KEY` (and the webhook) set on the server; PayPal needs the
`PAYPAL_*` values. Stripe and PayPal both support GBP.

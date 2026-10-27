# Chambelli Commerce Platform

One central product hub that powers shopping across the Chambelli network of 28 affiliate
websites. Products from CJ Dropshipping and owned stock live in one place; each site shows a
smart 30-product carousel with one script tag; shoppers can buy through Stripe or PayPal.
Existing affiliate content on the sites stays separate.

## What's inside

| Path                                                                         | What it does                                                               |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/api`                                                                   | Fastify API: carousels, analytics, cart, checkout, webhooks, admin, widget |
| `apps/admin`                                                                 | Next.js command centre: sales, CTR, product pipeline, sites, CJ sync       |
| `apps/worker`                                                                | CJ product sync, every six hours                                           |
| `apps/edge`                                                                  | Cloudflare Worker that caches public carousel feeds at the edge            |
| `apps/api/public/widget.js`                                                  | One-line embeddable carousel for any website                               |
| `packages/database`                                                          | Prisma client (schema in `prisma/schema.prisma`)                           |
| `packages/feeds`                                                             | Carousel feed engine with Redis cache                                      |
| `packages/cart`, `orders`, `payments`, `promotions`, `returns`               | Commerce flow                                                              |
| `packages/cj`                                                                | CJ Dropshipping connector                                                  |
| `packages/pricing`, `inventory`, `recommendations`, `analytics`, `reporting` | Catalog intelligence                                                       |
| `packages/carousel`                                                          | React carousel component                                                   |
| `packages/sdk`                                                               | Small client for storefronts                                               |

## Run it locally

Requires Node 20+ and Docker.

```bash
cp .env.example .env            # then set ADMIN_API_KEY (openssl rand -hex 32)
docker compose up -d postgres redis
corepack enable
pnpm install
pnpm db:generate
pnpm db:migrate --name init
pnpm db:seed
pnpm build
```

Then in separate terminals:

```bash
pnpm dev:api      # http://localhost:8080
pnpm dev:admin    # http://localhost:3001
pnpm dev:worker   # CJ sync (skips until CJ credentials are set)
```

The dashboard reads `PUBLIC_API_BASE_URL` and `ADMIN_API_KEY` from its environment; use the
same key as the API.

## Add the carousel to a website

```html
<script
  async
  src="https://YOUR_API_HOST/widget.js"
  data-api="https://YOUR_API_HOST"
  data-site="tech"
  data-placement="article-footer"
  data-title="Recommended Products"
  data-product-url="https://tech.example.com/shop/{slug}"
></script>
```

`data-site` is the website's slug in the hub. `data-product-url` is optional; `{slug}` and `{id}`
are filled in per product. The widget styles itself in a Shadow DOM, so site CSS cannot break it,
and it records loads, real impressions and clicks.

React sites can use `CommerceCarousel` from `@chambelli/carousel` instead.

## Payments

Orders are marked **paid only** by a verified provider confirmation, never by the shopper's
browser. Confirmation takes stock and counts promo-code uses in one transaction; if stock ran
out in the meantime, the order is held as `VALIDATION_REQUIRED` instead of being oversold.

- **Stripe:** `POST /v1/checkout` returns a PaymentIntent `clientSecret`. Point a Stripe webhook
  at `POST /v1/webhooks/stripe` for `payment_intent.succeeded`, `payment_intent.payment_failed`
  and `payment_intent.canceled`, and set `STRIPE_WEBHOOK_SECRET`.
- **PayPal:** checkout returns an `approveUrl`. After approval, the storefront calls
  `POST /v1/payments/paypal/:paypalOrderId/capture`. Optionally add a PayPal webhook at
  `POST /v1/webhooks/paypal` (`PAYMENT.CAPTURE.*` events) and set `PAYPAL_WEBHOOK_ID`.

Use sandbox credentials until launch.

## API overview

| Method | Path                                           | Notes                             |
| ------ | ---------------------------------------------- | --------------------------------- |
| GET    | `/health`, `/health/ready`                     | Liveness; readiness checks the DB |
| GET    | `/v1/carousels/:site/:placement`               | Public feed, up to 30 products    |
| POST   | `/v1/analytics`                                | Carousel events                   |
| GET    | `/widget.js`                                   | Embeddable widget                 |
| POST   | `/v1/cart/items`, GET `/v1/cart/:cartId`       | Cart                              |
| POST   | `/v1/checkout`                                 | Creates order and payment         |
| POST   | `/v1/payments/paypal/:id/capture`              | PayPal capture                    |
| POST   | `/v1/returns`                                  | Requires the order's email        |
| POST   | `/v1/webhooks/stripe`, `/v1/webhooks/paypal`   | Signature-verified                |
| GET    | `/v1/admin/overview`, `/products`, `/websites` | `x-admin-key` header required     |

## Security defaults

- Admin endpoints refuse every request until `ADMIN_API_KEY` (24+ characters) is set.
- Rate limiting on all routes, with tighter limits on checkout, capture and returns.
- Strict input validation; errors never expose internals.
- The edge worker caches only public carousel feeds and the widget.
- Set `CORS_ORIGINS` to lock browser access to your own domains, and `TRUST_PROXY=true`
  behind Cloudflare.

## Quality checks

```bash
pnpm format:check
pnpm typecheck        # after pnpm build
pnpm test             # unit tests, no database needed
pnpm test:integration # full order flow against the database in DATABASE_URL
```

GitHub Actions runs all of these on every push and pull request, including the integration
tests against a real PostgreSQL database.

## Deploy

- **API:** `docker build -f docker/api.Dockerfile .`, or `docker compose up -d` for the full
  stack. Run `pnpm db:deploy` (Prisma migrations) before starting a new version.
- **Edge cache:** set `API_URL` in `apps/edge/wrangler.toml`, then `pnpm --filter @chambelli/edge deploy`.
- **Admin:** any Next.js host; keep `ADMIN_API_KEY` server-side only.

## Before taking real orders

These are deliberately left as placeholders and must be connected first:

1. **Tax and shipping:** both are charged at zero today. Connect a jurisdiction-aware tax
   service and real shipping quotes.
2. **CJ order submission:** fulfilment calls CJ through the `CJOrderClient` interface, which is
   not wired up yet. The Bublu order-sync client is a tested starting point.
3. **CJ token refresh:** `CJ_ACCESS_TOKEN` expires and must be renewed; automate this with
   CJ's authentication API.
4. **Legal pages and policies** for checkout, returns and privacy on each storefront.

See `docs/PART2.md` for the commerce safety boundaries.

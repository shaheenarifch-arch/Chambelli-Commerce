# Chambelli Commerce Platform · Part 1

Central Product Hub and smart 30-product carousel starter for 28 affiliate websites. Existing affiliate content remains separate.

## Included
- PostgreSQL Product Hub and website registry
- Supplier, inventory, pricing, assignment, analytics, scoring, placement, and sync-job models
- Feed engine with Redis cache
- Fastify carousel and analytics APIs
- Reusable React carousel
- CJ connector framework and six-hour sync worker
- Admin dashboard starter
- JavaScript embed widget
- RAMBO categorization client
- Cloudflare edge-cache worker

## Run
```bash
cp .env.example .env
docker compose up -d postgres redis
corepack enable
pnpm install
pnpm db:generate
pnpm db:validate
pnpm db:migrate --name init
pnpm db:seed
pnpm build
pnpm dev:api
```

Run `pnpm dev:admin` and `pnpm dev:worker` in separate terminals. Configure the current official CJ API base URL and credentials through `.env`.

## Boundary
This is a runnable MVP starter, not a certified production release. Part 2 should add carts, Stripe, PayPal, orders, fulfillment, returns, coupons, and customer accounts.

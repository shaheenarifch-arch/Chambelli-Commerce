# Chambelli Commerce Platform · Part 2

Adds cart, checkout, Stripe PaymentIntents, PayPal Orders, order persistence, promotions, returns, mixed CJ/internal fulfillment routing, reporting, and a browser SDK.

## Safety boundaries
- Payment confirmation must come from verified Stripe and PayPal webhooks before marking orders paid.
- CJ fulfillment remains behind the `CJOrderClient` interface until wired to current official CJ order documentation.
- Taxes and shipping quotes are zero-value placeholders and must be connected to jurisdiction-appropriate services before launch.
- Never store raw card details.

## Setup
Run the Part 1 setup commands, add payment sandbox credentials to `.env`, then run `pnpm db:migrate --name part2_commerce`.

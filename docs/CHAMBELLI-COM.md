# chambelli.com catalog

[chambelli.com](https://chambelli.com) is one store that shows **every live carousel product** from
all Chambelli sites, sorted into departments. Each visitor sees the market of their nearest CJ
warehouse:

| chambelli.com | Chambelli market | CJ warehouse | Currency |
| ------------- | ---------------- | ------------ | -------- |
| `/us`         | US               | US           | USD      |
| `/uk`         | UK               | UK (GB)      | GBP      |
| `/eu`         | DE               | Germany      | EUR      |
| `/ca`         | CA               | Canada       | CAD      |

Only products you have **approved** (live) on a site's carousel appear. Waiting drafts never do.

## The catalog feed

`GET /v1/catalog/{us|uk|eu|ca}` returns, for one market:

- `departments`: slug, name and how many products each has;
- `products`: id, slug, title, photo, lowest in-stock price, currency, department, and the
  carousel `site` it sells through;
- `productPath`: the path of the product pages (`us`, `uk`, `de`, `ca`). A product's page is
  `/{productPath}/p/{slug}?site={site}`, with the existing cart and Stripe/PayPal checkout.

The same rules as the carousels apply: in stock, priced in the market's currency, and under
`CAROUSEL_MAX_PRICE`. The feed is cached for 10 minutes.

## Departments

Departments live in [`config/departments.json`](../config/departments.json):

- A product goes to the department of the **carousel site** it is live on (`sites`).
- Products only on mixed sites (CouponDepots, Boston Daily) go by their **CJ category**
  (`categories`).
- Anything left goes to `fallback` (Home, Kitchen & Furniture).

To move a site to another department, move its slug to that department's `sites` list, open a
pull request, then update the server ([DEPLOY.md](DEPLOY.md)). Each site may appear in only one
department; the tests check this.

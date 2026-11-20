# CJ categories → websites

`config/cj-site-map.json` decides which CJ Dropshipping categories feed which website.
Change the mapping there; no code change is needed.

## What uses it

| Part                                 | What it does                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CJ shortlist** (GitHub Actions)    | Searches each site's `terms` in CJ's **USA warehouse**, keeps products inside the site's `cjCategories`, skips brand names, and writes `shortlist/sites/<slug>.csv` for review. |
| **CJ sync worker** (every six hours) | Labels each synced product with its CJ top-level category, creates a Website row per mapped site, and links up to `productsPerSite` products to each site as **drafts**.        |

Nothing goes live on its own. A linked product stays `DRAFT` (hidden from carousels) until you
approve it on the dashboard's **Website carousels** page. Approving prices it at a 30% margin with
US shipping included (`SITE_US_SHIPPING_COST`) and sets its stock from CJ's US warehouse. Each
sync re-checks that stock, so sold-out products drop off the carousel by themselves.

The carousel has left and right arrows (and works with the keyboard's arrow keys), shows up to 50
products, and hides itself when a site has none approved. The embed code for each site is on the
same dashboard page.

ShopDress (shopdress.us) keeps its own department plan inside `scripts/cj-shortlist.mjs`.

## Fields

| Field                | Meaning                                                                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `productsPerSite`    | Most products per site carousel (50).                                                                                                                                                                                                          |
| `minProductsPerSite` | Fewest products a site should have (20); the dashboard flags sites below it.                                                                                                                                                                   |
| `slug`               | Site key used by the widget (`data-site`).                                                                                                                                                                                                     |
| `domain`             | The site's domain.                                                                                                                                                                                                                             |
| `cjCategories`       | CJ top-level categories, spelled as in CJ (e.g. `"Health, Beauty & Hair"`). Case and `&`/`and` don't matter.                                                                                                                                   |
| `terms`              | Search words. The worker searches them in CJ's US warehouse for sites short of products and offers the matches to that site first (most relevant). Also used by the shortlist.                                                                 |
| `titleMatch`         | Optional. A product title must contain one of these as a whole word, plurals included ("safe" matches "Safes" but not "Safety").                                                                                                               |
| `onlyOnSite`         | Optional, top level. `{ "shorts": "shopdress" }`: every CJ **US-warehouse** product whose title has the word is linked to that site (as a draft to approve) and taken off every other site's carousel. China-warehouse items are never linked. |
| `titleExclude`       | Optional. Never link a product whose title contains one of these whole words (e.g. no prescription items).                                                                                                                                     |

## Running the shortlist

1. Add the repository secret `CJ_API_KEY` once: **Settings → Secrets and variables → Actions → New
   repository secret**. The key is in CJ under **My CJ → Authorization → API**.
   [GitHub help](https://docs.github.com/actions/security-guides/using-secrets-in-github-actions)
2. **Actions → CJ shortlist → Run workflow**, choose `all`, `shopdress` or `sites`.
3. Open the `cj-shortlist` branch: `shortlist/sites/SUMMARY.txt` shows how many products each site got.

CJ API reference: [Product API](https://developers.cjdropshipping.com/en/api/api2/api/product.html)

## Sites with no CJ match (affiliate-only)

coupondepots.info, ezpass.uk, ticktes.online, desi.markets, luxurytravel.party,
authenticpakusa.com (own store), getservices.ai, bostondaily.us, faujileaks.com,
massmedicalcoding.com, buybeststores.uk (Buy buttons go to Fashtronix Hub).

# CJ categories → websites

`config/cj-site-map.json` decides which CJ Dropshipping categories feed which website.
Change the mapping there; no code change is needed.

## What uses it

| Part                                 | What it does                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CJ shortlist** (GitHub Actions)    | Searches each site's `terms` in CJ's **USA warehouse**, keeps products inside the site's `cjCategories`, skips brand names, and writes `shortlist/sites/<slug>.csv` for review. |
| **CJ sync worker** (every six hours) | Labels each synced product with its CJ top-level category, creates a Website row per mapped site, and links up to `productsPerSite` products to each site as **drafts**.        |

Nothing goes live on its own. A linked product stays `DRAFT` (hidden from carousels) until it
is approved, priced and given stock in the dashboard.

ShopDress (shopdress.us) keeps its own department plan inside `scripts/cj-shortlist.mjs`.

## Fields

| Field             | Meaning                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `productsPerSite` | Products per site (30 = one carousel).                                                                       |
| `slug`            | Site key used by the widget (`data-site`).                                                                   |
| `domain`          | The site's domain.                                                                                           |
| `cjCategories`    | CJ top-level categories, spelled as in CJ (e.g. `"Health, Beauty & Hair"`). Case and `&`/`and` don't matter. |
| `terms`           | Search words used for the shortlist.                                                                         |

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

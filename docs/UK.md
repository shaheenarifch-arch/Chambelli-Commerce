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

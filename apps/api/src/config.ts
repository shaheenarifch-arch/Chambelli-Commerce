/** Central runtime configuration, read once from the environment. */
export const config = {
  port: Number(process.env.PORT ?? 8080),
  adminApiKey: process.env.ADMIN_API_KEY ?? "",
  /** Public address of this API; the Canada storefront page loads its carousel from here. */
  publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL ?? "",
  /** Comma-separated list of allowed browser origins. Empty means any origin (public widget API). */
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Set when running behind Cloudflare or another proxy so rate limits see the real client IP. */
  trustProxy: process.env.TRUST_PROXY === "true",
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300),
  /** Canada chapter: charge GST/HST only after registering with the CRA. */
  canada: {
    gstHstRegistered: process.env.CA_GST_HST_REGISTERED === "true",
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  },
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID ?? "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
    baseUrl: process.env.PAYPAL_BASE_URL ?? "",
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "",
  },
};

export const MIN_ADMIN_KEY_LENGTH = 24;

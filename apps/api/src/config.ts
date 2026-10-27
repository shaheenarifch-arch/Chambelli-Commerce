/** Central runtime configuration, read once from the environment. */
export const config = {
  port: Number(process.env.PORT ?? 8080),
  adminApiKey: process.env.ADMIN_API_KEY ?? "",
  /** Comma-separated list of allowed browser origins. Empty means any origin (public widget API). */
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Set when running behind Cloudflare or another proxy so rate limits see the real client IP. */
  trustProxy: process.env.TRUST_PROXY === "true",
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300),
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

import { db } from "@chambelli/database";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { paymentModes } from "./commerceRoutes.js";

const app = await buildApp();

async function shutdown(signal: string) {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.port, host: "0.0.0.0" });

// Say plainly at startup whether real money can move, so a sandbox setup is never mistaken for live.
const modes = paymentModes();
app.log.info({ payments: modes }, `payments: PayPal ${modes.paypal}, Stripe ${modes.stripe}`);
if (modes.paypal !== "live" && modes.stripe !== "live")
  app.log.warn("no live payment provider: storefront checkout runs in test mode or is off");

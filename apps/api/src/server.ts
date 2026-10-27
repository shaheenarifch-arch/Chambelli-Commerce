import { db } from "@chambelli/database";
import { buildApp } from "./app.js";
import { config } from "./config.js";

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

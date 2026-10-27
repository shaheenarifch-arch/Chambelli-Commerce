import { randomBytes } from "node:crypto";

/** Human-friendly, collision-resistant order number, e.g. CH-20261026-9F2A61C4. */
export function generateOrderNumber(now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `CH-${day}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

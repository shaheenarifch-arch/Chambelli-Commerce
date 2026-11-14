import { db } from "@chambelli/database";
import { CJConnector } from "@chambelli/cj";
import { AmazonService, MARKETPLACES, settingsFromEnv } from "@chambelli/amazon";

let running = false;

/**
 * Checks every Amazon marketplace that has live listings against CJ stock and cost.
 * Results show on the Amazon page of the dashboard; nothing is sent to Amazon from here.
 */
export async function checkAmazonListings() {
  if (running || !process.env.CJ_ACCESS_TOKEN || !process.env.CJ_API_BASE_URL) return;
  running = true;
  try {
    const cj = new CJConnector(process.env.CJ_ACCESS_TOKEN, process.env.CJ_API_BASE_URL);
    const amazon = new AmazonService();
    for (const m of MARKETPLACES) {
      const live = await db.amazonListing.count({ where: { marketplace: m, state: "LIVE" } });
      if (!live) continue;
      const r = await amazon.checkListings(cj, settingsFromEnv(process.env, m));
      console.log(`Amazon ${m} check: ${r.checked} checked, ${r.failed} failed`);
    }
  } catch (e) {
    console.error("Amazon listing check failed", e);
  } finally {
    running = false;
  }
}

import { apiFile } from "../../../lib/api";

/** Downloads an Amazon upload file through the dashboard (the admin key stays on the server). */
const KINDS = new Set(["price-quantity", "new-listings"]);
const MARKETS = new Set(["US", "CA", "MX"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const m = url.searchParams.get("m") ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  if (!MARKETS.has(m) || !KINDS.has(kind)) return new Response("Not found", { status: 404 });
  const r = await apiFile(`/v1/admin/amazon/${m}/files/${kind}.txt`);
  if (!r.ok) return new Response("Could not build the file", { status: 502 });
  return new Response(await r.text(), {
    headers: {
      "content-type": "text/tab-separated-values; charset=utf-8",
      "content-disposition": `attachment; filename="${kind}-${m}.txt"`,
    },
  });
}

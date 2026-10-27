export interface Env {
  API_URL: string;
}

/** Only public, read-only carousel feeds and the widget script are cached at the edge. */
function isCacheable(request: Request, url: URL): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.has("authorization") || request.headers.has("x-admin-key")) return false;
  return url.pathname.startsWith("/v1/carousels/") || url.pathname === "/widget.js";
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const upstream = new URL(url.pathname + url.search, env.API_URL);
    // Forward everything else untouched: method, headers and body (cart, checkout,
    // analytics, webhooks, admin) so nothing private is ever cached.
    const forwarded = new Request(upstream.toString(), request);

    if (!isCacheable(request, url)) return fetch(forwarded);

    const cache = caches.default;
    const key = new Request(url.toString(), { method: "GET" });
    const hit = await cache.match(key);
    if (hit) return hit;

    const response = await fetch(forwarded);
    if (!response.ok) return response;
    const cached = new Response(response.body, response);
    cached.headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
    cached.headers.delete("set-cookie");
    ctx.waitUntil(cache.put(key, cached.clone()));
    return cached;
  },
};

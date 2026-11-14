/** Server-side calls to the Chambelli API with the admin key (never sent to the browser). */
export const apiBase = process.env.PUBLIC_API_BASE_URL ?? "http://localhost:8080";

const headers = () => ({ "x-admin-key": process.env.ADMIN_API_KEY ?? "" });

export type ApiResult<T> = { data: T | null; error: string | null };

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const r = await fetch(apiBase + path, { headers: headers(), cache: "no-store" });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      return { data: null, error: body.error ?? `HTTP ${r.status}` };
    }
    return { data: (await r.json()) as T, error: null };
  } catch {
    return { data: null, error: "API_UNREACHABLE" };
  }
}

export async function apiPost<T>(path: string, body: unknown = {}): Promise<ApiResult<T>> {
  try {
    const r = await fetch(apiBase + path, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) return { data: null, error: json.error ?? `HTTP ${r.status}` };
    return { data: json, error: null };
  } catch {
    return { data: null, error: "API_UNREACHABLE" };
  }
}

export async function apiFile(path: string): Promise<Response> {
  return fetch(apiBase + path, { headers: headers(), cache: "no-store" });
}

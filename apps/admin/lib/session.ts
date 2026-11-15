/**
 * Dashboard sign-in session. A signed cookie replaces the browser's Basic Auth popup,
 * which some Chrome extensions block. Uses Web Crypto so it runs in middleware and server code.
 * Login: user "shaheen", password ADMIN_DASHBOARD_PASSWORD from /etc/chambelli/env.
 */
export const SESSION_COOKIE = "chambelli_session";
export const SESSION_DAYS = 7;
export const DASHBOARD_USER = process.env.ADMIN_DASHBOARD_USER || "shaheen";

const enc = new TextEncoder();

function secret(): string {
  // Changing the password signs everyone out, because the key is derived from it.
  return `${process.env.ADMIN_DASHBOARD_PASSWORD ?? ""}|${process.env.ADMIN_API_KEY ?? ""}`;
}

/** True when a dashboard password is configured (always required in production). */
export function loginConfigured(): boolean {
  return Boolean(process.env.ADMIN_DASHBOARD_PASSWORD);
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function createSession(user: string): Promise<string> {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${user}.${expires}`;
  return `${payload}.${await sign(payload)}`;
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token || !loginConfigured()) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [user, expires, mac] = parts;
  if (user !== DASHBOARD_USER || !(Number(expires) > Date.now())) return false;
  return safeEqual(mac, await sign(`${user}.${expires}`));
}

/** Only allow same-site relative paths as the post-login destination. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login")
    ? next
    : "/";
}

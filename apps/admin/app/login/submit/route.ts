import {
  DASHBOARD_USER,
  SESSION_COOKIE,
  SESSION_DAYS,
  createSession,
  loginConfigured,
  safeEqual,
  safeNext,
} from "../../../lib/session";

/** Handles the sign-in form. Uses relative redirects so it works behind Caddy. */
export async function POST(req: Request) {
  const form = await req.formData();
  const user = String(form.get("user") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  const ok =
    loginConfigured() &&
    safeEqual(user, DASHBOARD_USER) &&
    safeEqual(password, process.env.ADMIN_DASHBOARD_PASSWORD ?? "");

  if (!ok) {
    // Slow down password guessing.
    await new Promise((r) => setTimeout(r, 1000));
    return new Response(null, {
      status: 303,
      headers: { Location: `/login?error=1&next=${encodeURIComponent(next)}` },
    });
  }

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `${SESSION_COOKIE}=${await createSession(user)}; Path=/; Max-Age=${
    SESSION_DAYS * 24 * 60 * 60
  }; HttpOnly; SameSite=Lax${secure}`;
  return new Response(null, { status: 303, headers: { Location: next, "Set-Cookie": cookie } });
}

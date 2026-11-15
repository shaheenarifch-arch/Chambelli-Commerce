import { SESSION_COOKIE } from "../../lib/session";

/** Signs out and returns to the sign-in page (relative redirect, so it works behind Caddy). */
export function GET() {
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/login",
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    },
  });
}

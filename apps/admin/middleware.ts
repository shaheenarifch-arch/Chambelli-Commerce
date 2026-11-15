import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, loginConfigured, verifySession } from "./lib/session";

/** Every dashboard page needs a signed-in session; /login and static assets stay open. */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // Local development without a password set: no sign-in.
  if (!loginConfigured() && process.env.NODE_ENV !== "production") return NextResponse.next();
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  // Build the address from the public host Caddy forwards, not the container's own address.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const login = `${proto}://${host}/login?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login, 307);
}

export const config = {
  // Node runtime so the password is read from the container's env at run time, not baked in at build.
  runtime: "nodejs",
  matcher: ["/((?!login|logout|_next/|favicon\\.ico).*)"],
};

import { DASHBOARD_USER, SESSION_DAYS, loginConfigured, safeNext } from "../../lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · Chambelli Commerce Hub" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <main className="login-wrap">
      <form action="/login/submit" method="post" className="card login-card">
        <h1>Sign in</h1>
        <p className="sub">Chambelli Commerce Hub dashboard</p>

        {!loginConfigured() ? (
          <div className="banner">
            No dashboard password is set. Add ADMIN_DASHBOARD_PASSWORD to /etc/chambelli/env and
            re-run the install script.
          </div>
        ) : error ? (
          <div className="banner">Wrong username or password. Try again.</div>
        ) : null}

        <input type="hidden" name="next" value={safeNext(next)} />
        <label>
          Username
          <input name="user" autoComplete="username" defaultValue={DASHBOARD_USER} required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
        </label>
        <button type="submit">Sign in</button>

        <p className="stat-note">
          Forgot the password? In the VM&apos;s SSH window run{" "}
          <code>sudo grep ADMIN_DASHBOARD_PASSWORD /etc/chambelli/env</code>. See{" "}
          <a href="https://github.com/shaheenarifch-arch/Chambelli-Commerce/blob/main/docs/DEPLOY.md">
            docs/DEPLOY.md
          </a>{" "}
          for details. You stay signed in for {SESSION_DAYS} days.
        </p>
      </form>
    </main>
  );
}

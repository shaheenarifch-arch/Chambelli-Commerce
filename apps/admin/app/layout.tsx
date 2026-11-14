import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "Chambelli Commerce Hub",
  description: "Central product hub for the Chambelli affiliate network",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="brand">
            <span className="logo">C</span>
            <strong>Chambelli Commerce Hub</strong>
            <nav className="topnav">
              <Link href="/">Overview</Link>
              <Link href="/amazon">Amazon US · CA · MX</Link>
              <Link href="/carousels">Website carousels</Link>
            </nav>
          </div>
          <span className="env">
            {process.env.NODE_ENV === "production" ? "Production" : "Development"}
          </span>
        </header>
        {children}
      </body>
    </html>
  );
}

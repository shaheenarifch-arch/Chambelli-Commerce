import React from "react";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body style={{ margin: 0, fontFamily: "system-ui", background: "#f5f7fb", color: "#111827" }}>
        <header style={{ padding: 20, background: "#111827", color: "white" }}>
          <strong>Chambelli Commerce Hub</strong>
        </header>
        {children}
      </body>
    </html>
  );
}

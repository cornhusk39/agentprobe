import "./globals.css";
import type { ReactNode } from "react";
import { suiteName } from "../lib/data";

export const metadata = {
  title: "AgentProbe",
  description: "A regression safety net for LLM agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="inner">
            <h1>AgentProbe</h1>
            <span className="sub">
              regression dashboard &middot; suite <code>{suiteName()}</code> &middot; replay demo, no
              live keys
            </span>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}

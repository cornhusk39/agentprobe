import "./globals.css";
import type { ReactNode } from "react";
import { suiteName } from "../lib/db";
import { Nav } from "../components/Nav";

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
              suite <code>{suiteName()}</code>
            </span>
            <Nav />
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}

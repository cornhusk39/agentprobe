import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { suiteName } from "../lib/db";

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
            <nav className="top">
              <Link href="/">Runs</Link>
              <Link href="/suite">Suite</Link>
              <Link href="/compare">Compare</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}

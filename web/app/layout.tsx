import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

import { headers } from "next/headers";
import { publicEnv } from "@/lib/env";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Folionix",
  description: "Self-hosted command center for your IDX portfolio.",
};

// Read NEXT_PUBLIC_* at request time (runtime), so the image stays
// environment-agnostic instead of baking the Supabase URL/key at build.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-request nonce from the proxy; ready for a future CSP, unused until then.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // Allowlist: only these public vars (from lib/env's PUBLIC_ENV_KEYS) reach the
  // browser. Escape "<" so a value can never break out of the <script> tag.
  const envJson = JSON.stringify(publicEnv()).replace(/</g, "\\u003c");

  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: `window.__ENV=${envJson}` }}
        />
      </head>
      <body className="min-h-full">
        <div className="flex min-h-screen flex-col md:flex-row">
          <Nav />
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}

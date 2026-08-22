import type { NextConfig } from "next";
import path from "path";

// 1 week fresh + 1 day stale-while-revalidate. Not `immutable` because the
// brand asset filenames aren't content-hashed, so a logo swap still propagates.
const BRAND_ASSET_CACHE = "public, max-age=604800, stale-while-revalidate=86400";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  transpilePackages: ["@folionix/lib"],
  async headers() {
    return [
      {
        source: "/logo/:path*",
        headers: [{ key: "Cache-Control", value: BRAND_ASSET_CACHE }],
      },
      {
        source: "/icon.svg",
        headers: [{ key: "Cache-Control", value: BRAND_ASSET_CACHE }],
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // No CSP yet: per-request nonces need every page rendered dynamically, which conflicts
  // with the prerendered shells used here. HSTS is left to Cloudflare,
  // because the LAN address uses Traefik's default certificate.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      // No framing anywhere, except the Help PDFs (/api/help/...), which the Help panel shows
      // in a frame on the hub itself; that route sends X-Frame-Options: SAMEORIGIN.
      {
        source: "/((?!api/help/).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;

import path from "node:path";
import type { NextConfig } from "next";

// The demo site: the public pages and the customer panel as a fully static export (no server, no API),
// for static hosting such as Tencent EdgeOne Pages. It reuses the components in ../src, so the admin area,
// the API routes and the proxy are never part of it. See docs/demo-site.md.
const root = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  output: "export",
  // `/login/` resolves to `login/index.html` on any static host.
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_DEMO_SITE: "1",
    // The panel lives at the site root here (/dashboard, /order, ...); in the main app's demo it is /demo/panel.
    NEXT_PUBLIC_PANEL_BASE: "",
  },
  turbopack: {
    root,
    resolveAlias: {
      // A Server Action cannot be exported statically: the language is kept in the browser instead.
      "@/app/home-locale-action": "./locale-action.ts",
    },
  },
};

export default nextConfig;

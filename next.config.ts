import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  logging: { incomingRequests: false, serverFunctions: false, browserToTerminal: false },
};

export default nextConfig;

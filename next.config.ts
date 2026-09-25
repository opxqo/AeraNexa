import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 更新时先编译到临时目录（NEXT_DIST_DIR=.next-build），成功后再和线上的 .next 对调，
  // 编译期间正在运行的网站不受影响；平时不设置，仍是默认的 .next（见 deploy/install.sh 的更新流程）
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  logging: { incomingRequests: false, serverFunctions: false, browserToTerminal: false },
};

export default nextConfig;

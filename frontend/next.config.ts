import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hostnames only (no scheme/port). Lets LAN/dev clients load /_next assets
  // so client components hydrate and the login form can POST via JS.
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.1.229"],
  transpilePackages: ["@hrmskdbl/depreciation-core"],
};

export default nextConfig;

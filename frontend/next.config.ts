import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@hrmskdbl/depreciation-core"],
};

export default nextConfig;

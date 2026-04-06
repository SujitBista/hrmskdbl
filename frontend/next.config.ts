import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/login", destination: "/admin", permanent: true },
      { source: "/dashboard", destination: "/admin/dashboard", permanent: true },
    ];
  },
};

export default nextConfig;

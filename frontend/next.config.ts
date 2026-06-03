import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@open-ormus/shared"],
  allowedDevOrigins: ['127.0.0.1'],
  experimental: {
    proxyClientMaxBodySize: '50mb',
  },
};

export default nextConfig;

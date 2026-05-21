import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@open-ormus/shared"],
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;

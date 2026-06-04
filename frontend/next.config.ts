import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@open-ormus/shared"],
  allowedDevOrigins: ['127.0.0.1'],
  experimental: {
    proxyClientMaxBodySize: '50mb',
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;

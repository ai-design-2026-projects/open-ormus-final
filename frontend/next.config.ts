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
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth/well-known/authorization-server",
      },
    ];
  },
};

export default nextConfig;

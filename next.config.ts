import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  transpilePackages: ["@luoleiorg/search-core"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.is26.com",
      },
      {
        protocol: "https",
        hostname: "c2.is26.com",
      },
      {
        protocol: "https",
        hostname: "static.is26.com",
      },
    ],
  },
};

export default nextConfig;

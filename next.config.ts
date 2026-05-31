import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/open-links",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

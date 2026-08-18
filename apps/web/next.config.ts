import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Internal packages ship TypeScript source (ADR-0002); Next compiles them.
  transpilePackages: ["@repo/ui"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Off so dev doesn't double-invoke effects, which would fire duplicate
  // (paid) translation requests and redundant canvas renders on every page.
  reactStrictMode: false,
};

export default nextConfig;

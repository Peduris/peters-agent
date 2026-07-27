import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep unpdf / its serverless pdfjs build external so Turbopack doesn't rewrite worker paths
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;

import type { NextConfig } from "next";

// Workspace packages are consumed as TypeScript source (no per-package build
// step), and their internal imports use NodeNext-style './file.js' specifiers
// so the same sources run under Node/tsx in the worker. Webpack does not map
// those to the '.ts' files on its own, so the alias below is what lets the
// web tier import @studio/domain without a build pipeline.
const nextConfig: NextConfig = {
  transpilePackages: ["@studio/domain"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;

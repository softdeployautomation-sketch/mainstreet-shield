import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MainStreet Shield runs as a real Node server on the VPS.
  // output: "standalone" only when BUILD_TARGET is set (EXE build path).
  output: process.env.BUILD_TARGET ? "standalone" : undefined,
  serverExternalPackages: [
    "bcrypt",
    "@prisma/client",
    // @cline/* packages are Node-only server SDKs (Cline Core). Next.js must NOT
    // bundle them — @cline/llms ships a browser build missing exports, and the
    // Cline SDK expects real Node require() resolution for its nested deps.
    // (Same reason spaceworker externalizes them; without this Turbopack fails
    // the build with 37 "Export … doesn't exist" errors from index.browser.js.)
    "@cline/sdk",
    "@cline/core",
    "@cline/llms",
    "@cline/agents",
    "@cline/shared",
  ],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;

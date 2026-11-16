import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MainStreet Shield runs as a real Node server on the VPS.
  // output: "standalone" only when BUILD_TARGET is set (EXE build path).
  output: process.env.BUILD_TARGET ? "standalone" : undefined,
  serverExternalPackages: ["bcrypt", "@prisma/client"],
};

export default nextConfig;
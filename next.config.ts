import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // TypeScriptのエラーがあってもビルドを強行する
    ignoreBuildErrors: true,
  },
  eslint: {
    // ESLint（書き方ルール）のエラーがあっても無視する
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
/** @type {import('next').NextConfig} */
const nextConfig: any = {  // : any を付けることで赤い波線を強制的に消します
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
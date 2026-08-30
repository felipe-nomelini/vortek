/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      { source: '/', destination: '/dashboard', permanent: true },
    ];
  },
};
export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable Next.js server since we use a custom server
  // The custom server (server/index.ts) will handle Next.js rendering
  
  reactStrictMode: true,
  
  // Transpile conductor package (shared types)
  transpilePackages: [],
  
  // Disable automatic static optimization for dynamic routes
  // All our pages need real-time data
  
  // Allow WebSocket upgrade on same port
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, must-revalidate',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

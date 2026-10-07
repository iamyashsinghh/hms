import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  transpilePackages: ['@hms/shared', '@hms/api-client'],
  async rewrites() {
    // Same-origin API so the httpOnly refresh cookie (Path=/api/v1/auth) works.
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg'],
  // @vividpages/db ships TypeScript source, so Next must transpile it.
  transpilePackages: ['@vividpages/db'],
};

export default nextConfig;

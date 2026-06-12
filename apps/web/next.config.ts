import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // pg and @node-rs/argon2 are native/Node-only and must not be bundled.
  serverExternalPackages: ['pg', '@node-rs/argon2'],
  // @vividpages/db ships TypeScript source, so Next must transpile it.
  transpilePackages: ['@vividpages/db'],
};

export default nextConfig;

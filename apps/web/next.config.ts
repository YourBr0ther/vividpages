import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // pg and @node-rs/argon2 are native/Node-only and must not be bundled.
  serverExternalPackages: ['pg', '@node-rs/argon2'],
  // @vividpages/db and @vividpages/core ship TypeScript source, so Next must
  // transpile them.
  transpilePackages: ['@vividpages/db', '@vividpages/core'],
};

export default nextConfig;

import type { NextConfig } from 'next';

// Note: the service worker is NOT wired in here. We use @serwist/next's
// configurator mode (see serwist.config.js), which builds public/sw.js as a
// separate post-`next build` step so the app's Turbopack build is unaffected.
const nextConfig: NextConfig = {
  output: 'standalone',
  // pg and @node-rs/argon2 are native/Node-only and must not be bundled.
  serverExternalPackages: ['pg', '@node-rs/argon2'],
  // @vividpages/db and @vividpages/core ship TypeScript source, so Next must
  // transpile them.
  transpilePackages: ['@vividpages/db', '@vividpages/core'],
};

export default nextConfig;

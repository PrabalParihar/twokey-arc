import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@twokey-arc/contracts', '@twokey-arc/core', '@twokey-arc/db', '@twokey-arc/money', '@twokey-arc/policy', '@twokey-arc/seal', '@twokey-arc/telegram'],
  serverExternalPackages: ['@node-rs/argon2', 'pg', 'pg-boss'],
  poweredByHeader: false,
  typedRoutes: false,
};

export default config;

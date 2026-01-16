import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // API proxying is now handled by proxy.ts
  // Enable experimental features for React 19
  experimental: {
    // Add any experimental features here
  },
};

export default nextConfig;

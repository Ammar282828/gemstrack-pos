
import type {NextConfig} from 'next';
// @ts-ignore because next-pwa types might not be perfectly aligned with Next.js 15
import withPWAInit from '@ducanh2912/next-pwa';

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // This is to fix a bug with genkit's dependency on handlebars.
    // It prevents webpack from trying to use a Node.js-specific feature.
    config.resolve.alias = {
      ...config.resolve.alias,
      'handlebars': 'handlebars/dist/handlebars.js',
    }
    return config
  },
};

const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  disable: process.env.NODE_ENV === 'development',
  // You can add more PWA options here, like runtime caching strategies
  // sw: "service-worker.js", // custom service worker name (optional)
});

export default withPWA(nextConfig);

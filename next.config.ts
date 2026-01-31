
import type {NextConfig} from 'next';
// @ts-ignore because next-pwa types might not be perfectly aligned with Next.js 15
import withPWAInit from '@ducanh2912/next-pwa';

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    unoptimized: true,
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
  // TEMPORARILY DISABLE PWA TO CLEAR OLD CACHES AND FIX 404 ERRORS
  disable: true, 
  fallbacks: {
    document: '/~offline', 
  },
  cacheOnFrontEndNav: true, 
  aggressiveFrontEndNavCaching: true, 
  reloadOnOnline: true, 
  sw: 'service-worker.js', 
});

export default withPWA(nextConfig);

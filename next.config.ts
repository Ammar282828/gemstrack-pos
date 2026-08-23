
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: false,
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
  // Mina's and Ammar's separate pages became one Shareholder Finances
  // section. Redirecting here rather than from a page component, because the
  // auth gate renders in place of page children — a redirect() inside the page
  // never runs until you are signed in, so the old URL would sit there showing
  // a sign-in screen it then never leaves.
  async redirects() {
    return [
      { source: '/mina', destination: '/shareholders', permanent: false },
      { source: '/ammar', destination: '/shareholders', permanent: false },
      // "Documents" said nothing about what the page holds. It is the billing
      // view: every order and invoice with what is still owed on it.
      { source: '/documents', destination: '/billing', permanent: false },
    ];
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'handlebars': 'handlebars/dist/handlebars.js',
    }
    return config
  },
};

export default nextConfig;


import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: false,
  // heic-convert carries libheif as WebAssembly. Loaded from node_modules at
  // runtime rather than bundled: webpack has no good answer for an 8 MB .wasm
  // that is loaded by path, and this route is the only thing that wants it.
  serverExternalPackages: ['heic-convert', 'heic-decode', 'libheif-js'],
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
      // "Documents" said nothing about what the page holds, and "Billing"
      // described the activity rather than the records. Both old URLs point
      // at /invoices.
      { source: '/documents', destination: '/invoices', permanent: false },
      { source: '/billing', destination: '/invoices', permanent: false },
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

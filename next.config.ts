import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Mongoose and bcrypt run only on the server; keep them out of the bundler.
  serverExternalPackages: ['mongoose', 'bcryptjs'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },
};

export default nextConfig;

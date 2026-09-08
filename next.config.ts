import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // The frontend was migrated in from Lovable with its own formatting
    // (narrower print width, CRLF line endings). `next build` runs ESLint
    // with eslint-plugin-prettier, which would flag ~6.5k cosmetic diffs
    // across frozen frontend + guarded backend files. Type-checking still
    // runs during build. Run `npm run lint` / `npm run format` for a
    // dedicated formatting pass.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OCR uses a native canvas binary plus Tesseract's Node worker. Keeping
  // these packages external lets Vercel/Node resolve their runtime assets
  // instead of trying to fold them into the route bundle.
  serverExternalPackages: ["@napi-rs/canvas", "tesseract.js", "tesseract.js-core"],
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

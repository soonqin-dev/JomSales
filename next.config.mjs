/** @type {import('next').NextConfig} */
const nextConfig = {
  // Separate disposable verification output from a running local dev server.
  distDir: process.env.JOMSALES_BUILD_DIR || ".next"
};
export default nextConfig;

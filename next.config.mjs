/** @type {import('next').NextConfig} */
const nextConfig = {
  // Separate disposable verification output from a running local dev server.
  distDir: process.env.JOMSALES_BUILD_DIR || ".next",
  async headers() {
    return ["/c/:path*", "/api/catalog/:path*"].map(source => ({ source, headers: [
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "X-Content-Type-Options", value: "nosniff" }
    ] }));
  }
};
export default nextConfig;

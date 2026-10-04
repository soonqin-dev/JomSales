/** @type {import('next').NextConfig} */
// Optional local build isolation avoids reusing OneDrive-locked test artifacts.
// Production/Vercel and normal development keep Next's default .next directory.
const isolatedBuild = process.env.SALESGO_ISOLATED_BUILD;
if (isolatedBuild && !/^[a-z0-9-]{1,64}$/i.test(isolatedBuild)) {
  throw new Error("SALESGO_ISOLATED_BUILD must be a short alphanumeric/hyphen build name.");
}
const nextConfig = isolatedBuild ? { distDir: `.next-salesgo/${isolatedBuild}` } : {};
export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard imports only types from the engine, so there is nothing to
  // transpile and no native dependency to externalize. Data comes from the
  // committed seed JSON, which is why the hosted demo needs no keys and no
  // database.
};

export default nextConfig;

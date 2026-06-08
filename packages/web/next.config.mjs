/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The interactive dashboard reads and writes the live SQLite database through
  // the engine, which uses better-sqlite3 (a native module). It must never be
  // bundled: the `bindings` resolver it depends on breaks under webpack. Mark it
  // external two ways for belt and suspenders.
  serverExternalPackages: ["better-sqlite3", "bindings"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        { "better-sqlite3": "commonjs better-sqlite3", bindings: "commonjs bindings" },
      ];
    }
    return config;
  },
};

export default nextConfig;

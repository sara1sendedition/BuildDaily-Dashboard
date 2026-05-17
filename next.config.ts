import type { NextConfig } from "next";

/** One source of truth with `lib/client-api-path.ts` (same env var). */
function basePathFromEnv(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
  const p = raw.replace(/\/$/, "");
  return p.length > 0 ? p : undefined;
}

const nextConfig: NextConfig = {
  basePath: basePathFromEnv(),
  async redirects() {
    return [
      {
        source: "/studio",
        destination: "/multiplier",
        permanent: true,
      },
    ];
  },
  serverExternalPackages: [
    "@napi-rs/canvas",
    "@tensorflow/tfjs-core",
    "@tensorflow/tfjs-backend-cpu",
    "@tensorflow/tfjs-converter",
    "@tensorflow-models/blazeface",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
    /**
     * Default is ~10MB; above that Next truncates the request body stream and
     * multipart video uploads fail with cryptic 500 / "Internal Server Error".
     * Keep in line with lib/stream-multipart-video MAX_UPLOAD_MB (default 500).
     */
    middlewareClientMaxBodySize: "500mb",
  },
};

export default nextConfig;

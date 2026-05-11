import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@arcpass/shared"],

  /**
   * Proxy /api/backend/* requests to the Fastify API service.
   * This avoids exposing the backend port publicly and eliminates
   * CORS issues since all requests stay on the same origin.
   *
   * Browser: GET /api/backend/health → Fastify: GET /health
   * Browser: POST /api/backend/wallets/register → Fastify: POST /wallets/register
   *
   * In Docker, API_URL_INTERNAL (http://api:4000) is used for service-to-service.
   * In local dev, falls back to http://localhost:4000.
   */
  async rewrites() {
    const apiDestination = process.env.API_URL_INTERNAL || "http://localhost:4000";
    return [
      {
        source: "/api/backend/:path*",
        destination: `${apiDestination}/:path*`,
      },
    ];
  },
};

export default nextConfig;

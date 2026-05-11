# ============================================================
# Stage 1: deps — Install workspace dependencies
# ============================================================
FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy workspace manifests only (for dependency caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies (dev needed for build tooling)
RUN pnpm install --frozen-lockfile

# ============================================================
# Stage 2: build — Build Next.js standalone output
# ============================================================
FROM deps AS build

WORKDIR /app

# Copy full source
COPY . .

# Build @arcpass/shared (prisma generate + tsc)
RUN pnpm --filter @arcpass/shared exec prisma generate
RUN pnpm --filter @arcpass/shared exec tsc

# NEXT_PUBLIC_* vars must be available at build time (inlined by Next.js)
ARG NEXT_PUBLIC_SPONSOR_VAULT_ADDRESS=
ARG NEXT_PUBLIC_SPONSORSHIP_REGISTRY_ADDRESS=
ENV NEXT_PUBLIC_SPONSOR_VAULT_ADDRESS=${NEXT_PUBLIC_SPONSOR_VAULT_ADDRESS}
ENV NEXT_PUBLIC_SPONSORSHIP_REGISTRY_ADDRESS=${NEXT_PUBLIC_SPONSORSHIP_REGISTRY_ADDRESS}
ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js app with standalone output
RUN pnpm --filter @arcpass/web run build

# ============================================================
# Stage 3: runtime — Minimal production image
# ============================================================
FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy standalone server
COPY --from=build /app/apps/web/.next/standalone ./

# Copy static assets
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

# Copy public assets
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000

# Next.js standalone server runs from the app directory
CMD ["node", "apps/web/server.js"]

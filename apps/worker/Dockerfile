# ============================================================
# Stage 1: deps — Install workspace dependencies
# ============================================================
FROM node:22-alpine AS deps

WORKDIR /app

# Enable corepack and prepare pnpm at the version specified in root package.json
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy workspace manifests only (for dependency caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies (dev + prod needed for compilation)
RUN pnpm install --frozen-lockfile

# ============================================================
# Stage 2: build — Compile TypeScript and generate Prisma client
# ============================================================
FROM deps AS build

WORKDIR /app

# Copy full source code
COPY . .

# Build @arcpass/shared (prisma generate + tsc)
RUN pnpm --filter @arcpass/shared exec prisma generate
RUN pnpm --filter @arcpass/shared exec tsc

# Build @arcpass/worker (tsc)
RUN pnpm --filter @arcpass/worker exec tsc

# ============================================================
# Stage 3: prod-deps — Install only production dependencies
# ============================================================
FROM node:22-alpine AS prod-deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# Install production dependencies only with hoisted node_modules for compatibility
RUN pnpm install --frozen-lockfile --prod --node-linker=hoisted

# ============================================================
# Stage 4: runtime — Minimal production image
# ============================================================
FROM node:22-alpine AS runtime

# Install openssl for Prisma query engine compatibility on Alpine/musl
RUN apk add --no-cache openssl

WORKDIR /app

# Copy production node_modules (hoisted, no symlinks)
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy built worker code
COPY --from=build /app/apps/worker/dist ./dist

# Copy built shared package into node_modules
COPY --from=build /app/packages/shared/dist ./node_modules/@arcpass/shared/dist
COPY --from=build /app/packages/shared/package.json ./node_modules/@arcpass/shared/package.json

# Copy Prisma schema and migrations for runtime migrations
COPY --from=build /app/packages/shared/prisma ./prisma

# Copy generated Prisma client
COPY --from=build /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client ./node_modules/.prisma/client

# Copy entrypoint script
COPY --from=build /app/apps/worker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Copy package.json for module resolution
COPY --from=build /app/apps/worker/package.json ./package.json

# Set production environment
ENV NODE_ENV=production

ENTRYPOINT ["./entrypoint.sh"]

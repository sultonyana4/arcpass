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
# Stage 2: build — Compile TypeScript and create production deploy
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

# Create isolated production deployment
RUN pnpm deploy --filter=@arcpass/worker --prod --legacy /app/deploy

# Copy the generated Prisma client (query engine binary) into the deploy output.
# pnpm deploy --prod skips postinstall scripts, so we copy from the build stage.
RUN mkdir -p /app/deploy/node_modules/.prisma && \
    cp -r /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client /app/deploy/node_modules/.prisma/client

# ============================================================
# Stage 3: runtime — Minimal production image
# ============================================================
FROM node:22-alpine AS runtime

# Install openssl for Prisma query engine compatibility on Alpine/musl
RUN apk add --no-cache openssl

WORKDIR /app

# Copy the isolated production deployment
COPY --from=build /app/deploy ./

# Copy Prisma schema and migrations directory
COPY --from=build /app/packages/shared/prisma ./prisma

# Copy entrypoint script
COPY --from=build /app/apps/worker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Set production environment
ENV NODE_ENV=production

ENTRYPOINT ["./entrypoint.sh"]

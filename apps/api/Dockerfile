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

# Install all dependencies (needed for prisma generate)
RUN pnpm install --frozen-lockfile

# ============================================================
# Stage 2: build — Generate Prisma client and build shared
# ============================================================
FROM deps AS build

WORKDIR /app

# Copy full source
COPY . .

# Build @arcpass/shared (prisma generate + tsc)
RUN pnpm --filter @arcpass/shared exec prisma generate
RUN pnpm --filter @arcpass/shared exec tsc

# ============================================================
# Stage 3: prod-deps — Production dependencies only
# ============================================================
FROM node:22-alpine AS prod-deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile --prod --node-linker=hoisted

# ============================================================
# Stage 4: runtime — Minimal production image
# ============================================================
FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl wget

WORKDIR /app

# Copy production node_modules (hoisted)
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy API source (plain JS, no build step needed)
COPY --from=build /app/apps/api/src ./src
COPY --from=build /app/apps/api/package.json ./package.json

# Copy built shared package into node_modules
COPY --from=build /app/packages/shared/dist ./node_modules/@arcpass/shared/dist
COPY --from=build /app/packages/shared/package.json ./node_modules/@arcpass/shared/package.json

# Copy Prisma schema and migrations for runtime
COPY --from=build /app/packages/shared/prisma ./prisma

# Copy generated Prisma client
COPY --from=build /app/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client ./node_modules/.prisma/client

ENV NODE_ENV=production

EXPOSE 4000

# Run migrations then start API
CMD ["sh", "-c", "npx prisma migrate deploy --schema=./prisma/schema.prisma && node -r dotenv/config src/server.js"]

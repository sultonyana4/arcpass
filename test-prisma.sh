#!/bin/sh
# Check in the build stage what's available
docker run --rm --entrypoint sh $(docker images -q arcpass-worker 2>/dev/null | head -1) -c 'find /app/node_modules -path "*/@prisma/engines/package.json" 2>/dev/null | head -5' 2>/dev/null

# Build a debug image to check the deploy directory
docker build --target build -t arcpass-worker-debug -f apps/worker/Dockerfile . 2>/dev/null
echo "=== Checking deploy for @prisma/engines ==="
docker run --rm arcpass-worker-debug sh -c 'find /app/deploy -path "*/@prisma/engines" -type d 2>/dev/null | head -5'
echo "=== Checking build node_modules for @prisma/engines ==="
docker run --rm arcpass-worker-debug sh -c 'find /app/node_modules -path "*/@prisma/engines" -type d 2>/dev/null | head -5'

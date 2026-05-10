#!/bin/sh

echo "Running database migrations..."

if npx prisma migrate deploy --schema=./prisma/schema.prisma; then
  echo "Migrations applied successfully. Starting worker..."
  exec node --import dotenv/config dist/main.js
else
  echo "ERROR: Database migration failed. Exiting." >&2
  exit 1
fi

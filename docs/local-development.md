# Local Development

Guide for setting up the ArcPass monorepo with a local PostgreSQL database.

## Prerequisites

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| Docker | Latest stable | Required for PostgreSQL container |
| Node.js | 22+ | LTS recommended |
| pnpm | 10+ | Must match `packageManager` field in root `package.json` (`pnpm@10.33.0`) |

Verify your installations:

```bash
docker --version
node --version   # should print v22.x.x or higher
pnpm --version   # should print 10.x.x or higher
```

## Setup

1. **Clone and install dependencies**

   ```bash
   git clone <repo-url> && cd arcpass
   pnpm install
   ```

2. **Copy environment variables**

   ```bash
   cp .env.example .env
   ```

   The default `.env.example` contains a `DATABASE_URL` pointing to the local Docker PostgreSQL instance — no edits needed.

3. **Start PostgreSQL**

   ```bash
   pnpm db:up
   ```

   This runs `docker compose up -d` and starts a PostgreSQL 16 container bound to `127.0.0.1:5432`.

4. **Run database migrations**

   ```bash
   pnpm db:migrate
   ```

   Applies all Prisma migrations and creates the schema in `arcpass_dev`.

5. **Generate Prisma client**

   ```bash
   pnpm db:generate
   ```

   Generates the typed Prisma client used by `@arcpass/shared`.

6. **Start applications**

   ```bash
   pnpm dev
   ```

   Starts all workspace apps (API, Web, Worker) via Turborepo.

## Verification

Confirm the database is reachable and healthy:

```bash
docker compose exec postgres pg_isready -U arcpass -d arcpass_dev
```

**Expected output:**

```
/var/run/postgresql:5432 - accepting connections
```

If you see `accepting connections`, the database is ready and migrations have been applied successfully.

## Troubleshooting

### Port 5432 already in use

**Symptom:** `docker compose up` fails with `bind: address already in use` on port 5432.

**Cause:** Another PostgreSQL instance or service is already listening on port 5432.

**Resolution:**

```bash
# Find the process using port 5432
sudo lsof -i :5432
# or
sudo ss -tlnp | grep 5432

# Stop the conflicting service (e.g., a system PostgreSQL)
sudo systemctl stop postgresql

# Then retry
pnpm db:up
```

---

### Connection refused

**Symptom:** `pnpm db:migrate` or application startup fails with `Connection refused` or `ECONNREFUSED 127.0.0.1:5432`.

**Cause:** The PostgreSQL container is not running or has not finished starting.

**Resolution:**

```bash
# Check container status
docker compose ps

# If the container is not running, start it
pnpm db:up

# Wait for the healthcheck to pass
docker compose exec postgres pg_isready -U arcpass -d arcpass_dev
```

If the container shows `unhealthy`, inspect logs:

```bash
docker compose logs postgres
```

---

### Migration conflicts

**Symptom:** `pnpm db:migrate` exits with an error about drift or failed migrations (e.g., `Migration failed to apply cleanly`).

**Cause:** The local database schema has drifted from the migration history, often due to manual schema changes or switching branches with different migrations.

**Resolution:**

```bash
# Reset the database (drops all data and re-applies migrations)
pnpm db:reset
```

> **Warning:** `db:reset` drops and recreates the database. All local data will be lost.

If you need to preserve data, consider creating a backup first:

```bash
docker compose exec postgres pg_dump -U arcpass arcpass_dev > backup.sql
```

---

### Volume cleanup / fresh start

**Symptom:** Corrupt data, stale state, or you want a completely clean environment.

**Cause:** The named Docker volume `arcpass_pgdata` persists data across container restarts. Sometimes a full reset is needed.

**Resolution:**

```bash
# Stop containers and remove the volume
docker compose down --volumes

# Restart from scratch
pnpm db:up
pnpm db:migrate
pnpm db:generate
```

This removes the `arcpass_pgdata` volume entirely and recreates the database from the migration history.

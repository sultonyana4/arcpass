---
title: "Operations Runbooks"
description: "Operational procedures for ArcPass Docker services including troubleshooting, recovery, and deployment verification."
---

# Operations Runbooks

This document provides operational procedures for maintaining and recovering ArcPass Docker services. Each procedure follows a consistent structure: **symptom**, **diagnostic commands**, **resolution steps**, and **verification**.

## Docker Rebuild Procedure

### Symptom

A service needs to be rebuilt after code changes, dependency updates, or configuration modifications.

### Diagnostic Commands

Check current container status and image age:

```bash
docker compose ps
docker compose images
```

### Resolution Steps

**Rebuild a single service** (e.g., `api`):

```bash
docker compose build --no-cache api
docker compose up -d api
```

**Rebuild all application services** (api, worker, web):

```bash
docker compose build --no-cache api worker web
docker compose down
docker compose up -d
```

**Full rebuild with volume cleanup** (destroys database data):

```bash
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

### Verification

```bash
docker compose ps
```

All services should show `Up` status with `(healthy)` where applicable.

---

## Troubleshooting

### Container Crash Loops

#### Symptom

A container repeatedly restarts, showing `Restarting` status in `docker compose ps` output.

#### Diagnostic Commands

```bash
docker compose ps
docker compose logs --tail=50 <service-name>
docker inspect --format='{{.State.ExitCode}}' arcpass-<service-name>-1
```

Replace `<service-name>` with `api`, `worker`, or `web`.

#### Resolution Steps

1. Check logs for the root cause (missing environment variable, connection error, syntax error):

```bash
docker compose logs --tail=100 <service-name>
```

2. If caused by a missing environment variable, add it to `docker-compose.yml` or a `.env` file and restart:

```bash
docker compose up -d <service-name>
```

3. If caused by a code error, rebuild the service:

```bash
docker compose build --no-cache <service-name>
docker compose up -d <service-name>
```

4. If caused by a dependency issue (e.g., postgres not ready), restart with dependency ordering:

```bash
docker compose down
docker compose up -d
```

#### Verification

```bash
docker compose ps
docker compose logs --tail=10 <service-name>
```

The service should show `Up` status without restarting. Logs should show normal operation.

---

### Database Connection Failures

#### Symptom

Services log errors containing `ECONNREFUSED`, `connection refused`, or `Can't reach database server` when attempting to connect to PostgreSQL.

#### Diagnostic Commands

```bash
docker compose ps postgres
docker compose logs --tail=30 postgres
docker compose exec postgres pg_isready -U arcpass -d arcpass_dev
```

#### Resolution Steps

1. If postgres is not running, start it:

```bash
docker compose up -d postgres
```

2. Wait for the health check to pass (up to 35 seconds with retries):

```bash
docker compose ps postgres
```

3. If postgres is running but rejecting connections, check for configuration issues:

```bash
docker compose logs --tail=50 postgres
```

4. If the volume is corrupted, recreate the database (destroys data):

```bash
docker compose down -v
docker compose up -d postgres
```

5. Once postgres is healthy, restart dependent services:

```bash
docker compose up -d api worker web
```

#### Verification

```bash
docker compose exec postgres pg_isready -U arcpass -d arcpass_dev
```

Expected output: `arcpass_dev - accepting connections`

---

### Health Check Failures

#### Symptom

A service shows `(unhealthy)` status in `docker compose ps` output, or dependent services fail to start because an upstream health check never passes.

#### Diagnostic Commands

```bash
docker compose ps
docker inspect --format='{{json .State.Health}}' arcpass-<service-name>-1
docker compose logs --tail=30 <service-name>
```

#### Resolution Steps

1. For **postgres** health check failures:

```bash
docker compose exec postgres pg_isready -U arcpass -d arcpass_dev
```

If this fails, postgres may still be initializing. Wait for the `start_period` (10s) to elapse, then check again.

2. For **api** health check failures:

```bash
docker compose exec api wget --no-verbose --tries=1 --spider http://127.0.0.1:4000/health
```

If the API is not responding, check logs for startup errors:

```bash
docker compose logs --tail=50 api
```

3. For **web** health check failures:

```bash
docker compose exec web wget --no-verbose --tries=1 --spider http://127.0.0.1:3000
```

If the web service is not responding, check for build or startup errors:

```bash
docker compose logs --tail=50 web
```

4. Restart the unhealthy service:

```bash
docker compose restart <service-name>
```

#### Verification

```bash
docker compose ps
```

All services should show `(healthy)` status.

---

## Health Verification

### PostgreSQL

**Health check command:**

```bash
docker compose exec postgres pg_isready -U arcpass -d arcpass_dev
```

**Expected response:**

```
arcpass_dev - accepting connections
```

---

### API Service

**Health check command:**

```bash
curl -s http://127.0.0.1:4000/health
```

**Expected response:**

```json
{"status":"ok","uptime":<seconds>}
```

Where `<seconds>` is an integer representing the process uptime.

---

### Worker Service

The worker does not expose an HTTP endpoint. Verify it is running and actively polling by checking logs:

**Health check command:**

```bash
docker compose logs --tail=20 worker
```

**Expected response:**

Logs should show periodic poll cycle activity. Look for entries from the `poller` logger indicating the worker is processing or idle (no error-level messages):

```
{"level":"info","msg":"Starting poll cycles","logger":"poller"}
```

If no recent log output exists, verify the container is running:

```bash
docker compose ps worker
```

The worker should show `Up` status.

---

### Web Service

**Health check command:**

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000
```

**Expected response:**

```
200
```

---

## Recovery Procedures

### Database Migration Failures

#### Symptom

Running Prisma migrations fails with errors such as `Migration failed to apply`, `P3009`, or `P3006`. The database may be in a partially migrated state.

#### Diagnostic Commands

```bash
docker compose exec postgres psql -U arcpass -d arcpass_dev -c "SELECT * FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;"
```

Check for migrations with `rolled_back` or `failed` status.

#### Resolution Steps

1. If a migration failed and needs to be retried, mark it as rolled back and re-apply:

```bash
docker compose exec -w /app api npx prisma migrate resolve --rolled-back <migration-name>
docker compose exec -w /app api npx prisma migrate deploy
```

2. If the schema is out of sync but data can be preserved, reset the migration state:

```bash
docker compose exec -w /app api npx prisma migrate resolve --applied <migration-name>
```

3. If the database is in an unrecoverable state and data loss is acceptable:

```bash
docker compose down -v
docker compose up -d postgres
docker compose up -d api
```

The API container will apply all migrations on startup via its dependency on a healthy postgres.

#### Verification

```bash
docker compose exec postgres psql -U arcpass -d arcpass_dev -c "SELECT migration_name, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY started_at;"
```

All migrations should show a non-null `finished_at` timestamp.

---

### Stuck PENDING Requests

#### Symptom

Sponsorship requests remain in `pending` status beyond the expected poll interval (default: 5000ms). The worker may have crashed during processing or lost its database connection.

#### Diagnostic Commands

```bash
docker compose exec postgres psql -U arcpass -d arcpass_dev -c "SELECT id, status, \"requestedAt\" FROM sponsorship_requests WHERE status = 'pending' ORDER BY \"requestedAt\" ASC LIMIT 10;"
```

Check worker logs for errors:

```bash
docker compose logs --tail=50 worker
```

#### Resolution Steps

1. Verify the worker is running:

```bash
docker compose ps worker
```

2. If the worker is stopped or in a crash loop, restart it:

```bash
docker compose restart worker
```

3. If the worker is running but not processing, check for database connectivity:

```bash
docker compose exec postgres pg_isready -U arcpass -d arcpass_dev
```

4. If the worker is running and postgres is healthy, the requests should be picked up on the next poll cycle. Force a restart to trigger an immediate poll:

```bash
docker compose restart worker
```

5. If requests are stuck in `relayed` status with no active relay transaction (stale relayed), the worker's recovery logic will automatically re-process them on the next poll cycle. Restart the worker to trigger this:

```bash
docker compose restart worker
```

#### Verification

```bash
docker compose exec postgres psql -U arcpass -d arcpass_dev -c "SELECT id, status FROM sponsorship_requests WHERE status = 'pending' ORDER BY \"requestedAt\" ASC LIMIT 10;"
```

The query should return fewer (or zero) pending requests after the worker processes them.

---

### Worker Restart

#### Symptom

The worker process needs to be restarted due to configuration changes, stuck state, or after a deployment.

#### Diagnostic Commands

```bash
docker compose ps worker
docker compose logs --tail=20 worker
```

#### Resolution Steps

1. Graceful restart (sends SIGTERM, allows in-progress relay to complete within the 10-second shutdown timeout):

```bash
docker compose restart worker
```

2. If the worker is unresponsive to graceful shutdown, force stop and restart:

```bash
docker compose stop -t 15 worker
docker compose up -d worker
```

3. If a full rebuild is needed (after code changes):

```bash
docker compose build --no-cache worker
docker compose up -d worker
```

#### Verification

```bash
docker compose ps worker
docker compose logs --tail=10 worker
```

The worker should show `Up` status and logs should indicate successful startup with `Starting poll cycles`.

---

## Deployment Verification Checklist

After deploying or restarting the full stack, verify each service in dependency order:

### 1. PostgreSQL is accepting connections

```bash
docker compose exec postgres pg_isready -U arcpass -d arcpass_dev
```

Expected: `arcpass_dev - accepting connections`

### 2. API returns healthy from `/health`

```bash
curl -s http://127.0.0.1:4000/health
```

Expected: `{"status":"ok","uptime":<seconds>}`

### 3. Worker is polling and processing requests

```bash
docker compose logs --tail=10 worker | grep -i "poll\|start"
```

Expected: Log entries showing `Starting poll cycles` or poll activity without errors.

### 4. Web is serving pages

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000
```

Expected: `200`

<Note>Run these checks in order. Each service depends on the previous one being healthy. If any check fails, refer to the corresponding troubleshooting section above.</Note>

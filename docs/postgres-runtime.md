Create a new spec named "postgres-runtime".

Context files:
- docs/architecture.md
- docs/database-model.md
- docs/postgres-runtime.md
- AGENTS.md

Goal:
Set up local PostgreSQL runtime and Prisma runtime integration for ArcPass monorepo.

Scope:
- Docker Compose PostgreSQL service
- Persistent Docker volume
- DATABASE_URL strategy
- Prisma migration runtime workflow
- Prisma Studio support
- Healthcheck strategy
- pnpm workspace integration
- Local development workflow
- Worker + API shared database access
- Environment variable documentation
- Connection validation
- Safe local development defaults

Constraints:
- Use PostgreSQL only
- No cloud provider setup
- No production deployment yet
- No auth system yet
- No Redis yet
- Must follow existing monorepo structure
- TypeScript ESM only
- Use pnpm workspace conventions
- Must integrate with existing packages/shared Prisma package

Deliver:
- requirements.md
- design.md
- tasks.md
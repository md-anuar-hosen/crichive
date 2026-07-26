# CricHive

Cricket scoring and tournament platform.
Backend: Node 24 + Express 5 + TypeScript + Kysely + Postgres (Neon, eu-north-1).
App: Flutter (later).

## Architecture rules
- `backend/src/domain/**` is PURE: no DB, no I/O, no imports from routes or db.
  All cricket logic lives there and is unit-tested with vitest.
- `deliveries` is append-only. NEVER UPDATE or DELETE a ball.
  Corrections void the row (`voided_at`) and append a replacement.
- Every ball carries a `client_event_id` from the scorer's device for idempotency.
- `players.suomisport_id` must NEVER appear in any public API response.
- Format rules come from the `tournament_rules` table. Never hardcode
  overs, bowler quota, powerplay, or points values.
- Roles are tournament-scoped, not global. Check on every write.

## Commands
cd backend && pnpm dev | pnpm test | pnpm codegen
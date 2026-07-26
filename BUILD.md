# CricHive — Build Specification

Implement this entire specification. Work phase by phase. After each phase:
run the verification, fix anything failing, then `git commit` with a clear
message before moving on. Do not skip verifications. Do not move to the next
phase while the current one fails.

Stack: Node 24, Express 5, TypeScript, Kysely, Postgres (Neon, Frankfurt),
vitest. Flutter app comes later — backend only in this spec.

---

## Invariants (apply to every phase)

1. `backend/src/domain/**` is PURE. No database access, no I/O, no imports
   from `routes/` or `db/`. Only pure functions over plain data. All cricket
   logic lives here.
2. `deliveries` is append-only. NEVER `UPDATE` or `DELETE` a ball. Corrections
   set `voided_at` and append a replacement row.
3. Every delivery carries a `client_event_id` (UUID from the scorer's device).
   `UNIQUE (innings_id, client_event_id)` makes retries idempotent — a repeat
   returns the existing row with 200, never a duplicate or an error.
4. `players.suomisport_id` must NEVER appear in any public API response.
   Enforce with an explicit serializer, and add a test that greps every public
   route's JSON for the field.
5. Format rules come from `tournament_rules`. Never hardcode overs, bowler
   quota, powerplay length, or points values anywhere.
6. Roles are tournament-scoped via `tournament_memberships`, never global.
   Check on every write.
7. All derived tables (`innings_totals`, `batting_cards`, `bowling_cards`,
   `partnerships`, `standings`, `player_career_stats`) are caches. It must
   always be possible to rebuild them from `deliveries` alone.

---

## PHASE 1 — Parameterised seed

`backend/src/seed/seed.ts`, run via `pnpm seed`.

Config from env vars, with defaults. Nothing about size hardcoded:

- `TEAMS` = 42
- `PLAYERS_PER_TEAM` = 13
- `GROUP_SIZE` = 6
- `GROUNDS` = 4
- `OVERS` = 10

Behaviour:

- Group count derived from `TEAMS / GROUP_SIZE`, remainder distributed evenly.
- If `GROUP_SIZE >= TEAMS`, produce a single group.
- Round-robin generation must work for any group size, odd or even.
- `tournament_rules` derived from `OVERS`: `max_overs_per_bowler = ceil(OVERS/5)`,
  `powerplay_overs = ceil(OVERS * 0.3)`.

Creates: tournament "Finn-Bangla Cricket Tournament 2026" (slug
`finn-bangla-2026`, season_year 2026, organizer_org "Cricket Finland",
country_code FI, ball leather); tournament_rules; grounds in Finnish cities;
teams with Finnish-Bangladeshi club names and 3-4 char short_names; players
with Bengali names, unique 9-digit `suomisport_id`s, random batting/bowling
styles; `team_squads` rows; one stage of kind `group`; the groups; full
round-robin fixtures spread across grounds in 90-minute slots.

Idempotent: delete existing rows for this tournament first, FK-safe order.

**Verify:** `pnpm seed` gives 42 teams / 546 players / 7 groups / 105 matches.
Then `TEAMS=8 GROUP_SIZE=4 pnpm seed` gives 8 teams / 2 groups / 12 matches.

---

## PHASE 2 — Auth

- `POST /auth/register` — email, password, display_name. bcrypt, cost 12.
- `POST /auth/login` — returns JWT (24h) containing `sub` and
  `is_platform_admin`. Never put roles in the token; they change.
- `GET /auth/me`
- `requireAuth` middleware — verifies JWT, attaches `req.user`.
- `requireTournamentRole(role)` middleware — queries `tournament_memberships`
  for the tournament in the route params. Platform admins bypass.

Validate every body with zod. Return 400 with field errors on failure.

**Verify:** integration tests — a scorer's token is rejected (403) on an
organizer-only route; an expired token gives 401; register with a duplicate
email gives 409.

---

## PHASE 3 — Public read API

No authentication. All responses go through serializers that strip
`suomisport_id`, `date_of_birth`, and any `phone` or `email`.

- `GET /tournaments`
- `GET /tournaments/:slug`
- `GET /tournaments/:slug/teams`
- `GET /tournaments/:slug/fixtures` — filter by group, date, team, status
- `GET /tournaments/:slug/standings`
- `GET /teams/:id`
- `GET /teams/:id/squad/:tournamentSlug`
- `GET /players/:id` — profile plus career stats
- `GET /matches/:id` — full scorecard
- `GET /live` — all currently live matches across tournaments

Paginate anything list-shaped. Cache-Control 30s on public reads.

**Verify:** a test that hits every public route and asserts the serialized
JSON contains no `suomisport_id`, no `date_of_birth`, no `phone`, no `email`.

---

## PHASE 4 — Scoring engine (the core; take the most care here)

Pure TypeScript in `backend/src/domain/scoring/`. No DB imports.

Core type:

```ts
type Delivery = {
  overNumber: number;        // 0-indexed
  ballInOver: number;        // 1..6, legal balls only
  sequence: number;          // absolute order in innings
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  runsOffBat: number;
  extraWides: number;
  extraNoballs: number;
  extraByes: number;
  extraLegbyes: number;
  extraPenalty: number;
  isLegalDelivery: boolean;
  isFreeHit: boolean;
  wicketKind?: DismissalKind;
  playerOutId?: string;
  fielderId?: string;
  voidedAt?: Date;
};
```

Main function:
`buildScorecard(deliveries: Delivery[], rules: TournamentRules): Scorecard`

It must filter out voided deliveries, then fold over the rest.

### Cricket rules that MUST be correct

Get these exactly right. They are the ones naive implementations break on.

**Extras and ball counting**
- Wide: `wide_runs` (default 1) plus any runs run. Not a legal ball. Not
  charged to the batter's ball count. Charged to the bowler.
- No-ball: `noball_runs` (default 1) plus runs off bat. Not a legal ball.
  Runs off the bat DO count to the batter and to their balls faced. All of it
  charged to the bowler.
- Byes and leg-byes: legal ball, counts to the over and to balls faced, but
  runs go to the team, NOT to the batter, and are NOT charged to the bowler.
- Penalty runs: to the team only. No ball counted.

**Free hit**
- Set on the delivery after a no-ball when `free_hit_after_noball` is true.
- On a free hit the batter cannot be out except run out, obstructing the field,
  or hit ball twice. Bowled, caught, LBW, stumped must be rejected as invalid.
- A free hit persists if the following delivery is itself illegal (a wide on a
  free hit means the next ball is still a free hit).

**Strike rotation**
- Odd runs off the bat swap strike.
- Byes and leg-byes: odd number run also swaps strike.
- End of over swaps strike — apply AFTER the last legal ball of the over.
- On a wide or no-ball, runs run still rotate strike normally.
- Run out: the batter who is out may be either the striker or non-striker.
  After a run out, the striker for the next ball depends on how many runs were
  completed and which end each batter finished at. Model this explicitly, do
  not assume the new batter is on strike.
- Caught out: new batter is on strike UNLESS the batters crossed before the
  catch AND it was the last ball of the over.

**Bowler quota**
- Max `max_overs_per_bowler` per bowler. Enforce BEFORE accepting a ball, not
  after. Reject the delivery with a clear error.
- A bowler may not bowl two consecutive overs.

**Maiden**
- An over is a maiden if zero runs are charged to the bowler across it.
  Byes and leg-byes conceded do NOT break a maiden. Wides and no-balls DO.

**Wickets**
- Bowler is credited for: bowled, caught, lbw, stumped, hit_wicket.
- Bowler is NOT credited for: run_out, retired_out, obstructing_the_field,
  hit_ball_twice, timed_out.
- retired_hurt is not a dismissal — the batter may return later. Do not
  increment the wicket count for it.
- Innings ends when wickets reach `players_per_side - 1`, or overs are
  exhausted, or the target is passed.

**Partnerships**
- A partnership runs between two batters at the crease, ends on each wicket.
  Track runs and balls for each.

**Innings end and result**
- Chasing side wins the moment the target is passed — the ball on which it
  happens ends the innings immediately.
- Margin: batting-first winner wins "by N runs"; chasing winner wins
  "by N wickets" where N = `players_per_side - 1 - wicketsLost`.
- Tie: scores level with the chasing innings complete. If
  `super_over_on_tie`, create innings 3 and 4.

**Super over**
- One over per side, `players_per_side` limited to 3 batters, innings ends at
  2 wickets. Separate innings rows with `is_super_over = true`. Must not
  contribute to career stats or NRR.

### Tests — write these before the implementation

Each of the following is its own test case with hand-computed expectations:

1. A clean over of six dot balls → 0/0, 6 legal balls, bowler maiden.
2. Wide then a legal ball → over has 2 deliveries, 1 legal ball, 1 extra run.
3. No-ball with 4 off the bat → batter +4 and +1 ball faced, bowler +5.
4. Free hit: bowled is rejected as invalid; run out is accepted.
5. Free hit followed by a wide → the next ball is still a free hit.
6. Three leg-byes → team +3, batter +0 runs but +1 ball, bowler +0, strike swaps.
7. Two runs then end of over → strike does NOT swap (even runs, then over swap).
8. One run on the last ball of an over → strike swaps twice, so the same batter
   is on strike for the next over.
9. Bowler attempting a third over when quota is 2 → rejected.
10. Bowler attempting consecutive overs → rejected.
11. Run out on the non-striker with one run completed → correct batter out,
    correct striker next ball.
12. Ninth wicket in a 10-a-side tournament → innings ends.
13. Chase passing the target mid-over → innings ends on that ball, margin is
    "won by N wickets".
14. Scores level at the end of innings 2 → tie, super over created.
15. A voided delivery is excluded from every total.
16. Full-innings replay: take a real T10 scorecard, feed all deliveries,
    assert total runs, wickets, every batter's line, every bowler's line.

`pnpm test` must be fully green before Phase 5.

---

## PHASE 5 — Scoring API

- `POST /matches/:id/toss` — winner and decision, creates innings 1
- `POST /matches/:id/playing-xi` — validates against `team_squads`
- `POST /matches/:id/deliveries` — body includes `client_event_id`.
  On duplicate `client_event_id`, return the existing delivery with 200.
  Validate against the scoring engine BEFORE inserting; reject invalid balls
  with 422 and a readable message.
- `POST /matches/:id/deliveries/:id/void` — sets `voided_at`, requires a reason,
  writes to `audit_log`
- `POST /matches/:id/innings/:n/close`
- `GET /matches/:id/scorecard` — from derived tables, not recomputed live

After each accepted delivery, update `innings_totals`, `batting_cards`,
`bowling_cards`, `partnerships` in the same transaction as the insert.

Add `pnpm rebuild-derived` — a command that wipes all derived tables and
recomputes them from `deliveries`. This is the proof that the event log is the
only source of truth.

**Verify:** post the same delivery twice with the same `client_event_id` —
exactly one row exists. Run `rebuild-derived` after a full match and confirm
every derived value is byte-identical.

---

## PHASE 6 — Standings and stats

`backend/src/domain/standings/` — pure functions.

- Points from `tournament_rules`.
- NRR = (runs scored / overs faced) − (runs conceded / overs bowled).
  A team bowled out counts as having faced the FULL quota of overs, not the
  overs actually faced. This is the rule most implementations get wrong.
- No-result matches are excluded from NRR entirely.
- Rank by points, then NRR, then head-to-head, then alphabetical.
- Super over innings are excluded from NRR and from career stats.

Recompute `standings` for the group on match completion.
Recompute `player_career_stats` for affected players on match completion.

**Verify:** unit tests for NRR including the bowled-out case and the
no-result exclusion.

---

## PHASE 7 — Realtime

- WebSocket (`ws`) at `/ws`. Client subscribes to `match:{id}`.
- On each accepted delivery, broadcast a delta: the ball, updated totals, the
  two batters' lines, the bowler's line.
- Read-only for clients; all writes go through the REST API.
- Heartbeat every 30s, drop dead connections.
- On reconnect the client sends the last `sequence` it saw and receives
  everything after it.

**Verify:** two clients subscribed to the same match both receive every ball
in order; a client reconnecting after missing 5 balls receives exactly those 5.

---

## PHASE 8 — Hardening

- Rate limit: 100 req/min per IP on public routes, 600/min on scoring routes
  (a scorer is legitimately fast).
- Helmet, CORS restricted to known origins.
- Structured request logging with a request id.
- `audit_log` written on every mutation of players, squads, matches, and any
  void.
- `GET /health` and `GET /health/db` remain.
- A `data_requests` endpoint for GDPR correction/erasure requests.

---

## Definition of done

- `pnpm test` green, with the scoring engine covering every case listed.
- `pnpm seed && pnpm rebuild-derived` runs clean.
- No public response contains `suomisport_id`.
- A full match can be scored end to end through the API, with a second client
  receiving live updates, and the final scorecard matches hand calculation.

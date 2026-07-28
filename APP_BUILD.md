# CricHive App — Build Specification

Flutter client for the CricHive backend. Work phase by phase in `app/`.
After each phase: run the verification, fix anything failing, then
`git commit` with a clear message before moving on.

Stack: Flutter (stable channel), Dart, `riverpod` for state, `dio` for HTTP,
`go_router` for navigation, `flutter_secure_storage` for the JWT,
`web_socket_channel` for realtime.

Backend contract is `backend/src/routes/{public,auth,scoring}.ts` — read
those, don't guess shapes. Public API strips `suomisport_id`,
`date_of_birth`, `phone`, `email` already; the app never needs to filter
these itself.

---

## Invariants (apply to every phase)

1. No screen invents its own copy of backend business logic (over limits,
   points, NRR, dismissal rules). The app only renders what the API returns
   and sends user input to it — the domain lives in `backend/src/domain/**`.
2. The JWT never contains roles (they change) — always re-check
   `/auth/me` / a fresh 403 rather than caching a role client-side as the
   source of truth for what's allowed.
3. Every scored delivery carries a client-generated `client_event_id`
   (UUID) so retries on a flaky connection are idempotent. Generate it once
   per ball, before the request goes out, and reuse it on retry.
4. Public read screens must work fully logged-out. Auth is only required for
   the scoring flow.
5. No hardcoded overs/bowler-quota/points/powerplay values in the app —
   they come from `tournament.rules` on `GET /tournaments/:slug`.

---

## PHASE 1 — Scaffold, API client, public read views

`flutter create` in `app/`. Folder structure: `lib/api/`, `lib/models/`,
`lib/screens/`, `lib/widgets/`, `lib/theme/`.

- `ApiClient` (dio) wrapping `http://localhost:3000` (configurable via
  `--dart-define=API_BASE_URL`), typed methods for every `public.ts` route.
- Models: `Tournament`, `Team`, `Player`, `Fixture`, `Standing`, `Match`
  (+scorecard), `LiveMatch` — plain Dart classes with `fromJson`.
- `go_router` shell with bottom nav: Tournaments, Live, (Profile once auth
  lands).
- Screens: tournament list → tournament detail (tabs: Fixtures / Teams /
  Standings) → team squad → player profile. `GET /live` as the Live tab.
- Loading/empty/error states on every screen (no bare spinners forever, no
  silent failures).

**Verify:** `flutter analyze` clean. Run against the real backend
(`pnpm dev` in `backend/`, seeded data) on Chrome or Windows desktop; walk
tournament list → detail → fixtures/standings/teams → a player profile,
confirm real seeded data renders and no `suomisport_id` etc. ever appears
(it can't — the API already strips it — but confirm no crash on the fields
that replace it).

---

## PHASE 2 — Auth

- Login / register screens using `POST /auth/login`, `POST /auth/register`.
- Store JWT in `flutter_secure_storage`; attach `Authorization: Bearer` via
  a dio interceptor; on 401, clear token and route to login.
- `AuthState` (riverpod) hydrated from stored token + `GET /auth/me` on
  app start.
- Profile tab: shows display name/email, logout.

**Verify:** register a new user through the running app against the dev
backend, confirm `GET /auth/me` renders, confirm logout clears the token
(kill and relaunch app, lands on logged-out state).

---

## PHASE 3 — Match detail + scorecard

- Match screen: `GET /matches/:id` (or `/matches/:id/scorecard`) — score
  header (runs/wickets/overs per innings), batting card, bowling card,
  partnerships, result banner when completed.
- Reachable from fixtures list and from the Live tab.
- Pull-to-refresh.

**Verify:** open a completed seeded match, confirm the rendered scorecard
matches what `GET /matches/:id` returns byte-for-byte (spot check a few
numeric fields against the raw JSON).

---

## PHASE 4 — Realtime

- `RealtimeClient` over `web_socket_channel` to `/ws`, subscribes to
  `match:{id}` when a match screen showing a live/in-progress match is
  open, unsubscribes on dispose.
- On each `delivery` message, patch the in-memory scorecard (totals,
  striker/non-striker/bowler lines) without a full refetch.
- On reconnect, resend the last-seen `sequence` so the server can replay
  what was missed; heartbeat awareness (don't treat a missed beat as
  instant disconnect, but do recover from a real drop).

**Verify:** with two app instances (or one app + one raw `wscat` client)
subscribed to the same live match, post a delivery via the scoring API and
confirm both receive it in order; kill the network briefly and confirm the
app recovers and backfills via the sequence replay rather than showing
stale data forever.

---

## PHASE 5 — Scoring UI

Gated behind `organizer` or `scorer` role on the tournament (check via a
403 from the scoring API, not a client-side role cache — see invariant 2).

- Toss screen: `POST /matches/:id/toss`.
- Playing XI screen: pick 2×`players_per_side` from each team's squad,
  captain/keeper, `POST /matches/:id/playing-xi`.
- Ball-by-ball scoring screen: runs pad (0-6), extras (wide/no-ball/bye/
  leg-bye/penalty), wicket flow (kind, batter out, fielder), free-hit
  indicator, current over display, undo-via-void (`POST
  /matches/:id/deliveries/:deliveryId/void` with a reason — never a raw
  delete). Every submit carries a freshly-generated `client_event_id`;
  network retry reuses the same id.
- Innings close / match complete actions.

**Verify:** score a full match ball-by-ball through the app against the
dev backend end to end (toss → playing XI → all deliveries → innings
close ×2 → result), then run `pnpm rebuild-derived` in `backend/` and
confirm the derived scorecard is unchanged — proof the app never bypassed
the API's validation.

---

## PHASE 6 — Polish

- GDPR `data_requests` screen (correction/erasure) per `dataRequests.ts`.
- Consistent error surfaces (toast/snackbar) for 400/401/403/409/422.
- App icon, splash, name ("CricHive").
- Final pass: `flutter analyze` clean, cold-start on a clean install lands
  on the tournament list logged out.

---

## Definition of done

- `flutter analyze` clean, no TODO-shaped dead ends.
- A full match can be scored end to end through the app against the real
  backend, with a second client (app or raw WS) receiving live updates.
- Logged-out users can browse every public read screen; scoring screens are
  unreachable without the right tournament role.

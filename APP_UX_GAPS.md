# CricHive — UX gap closure vs. CricHeroes / Cricbuzz

Studied CricHeroes (cricket scoring + tournament management) and Cricbuzz
(live viewer) to identify standard cricket-app features CricHive was
missing. Work phase by phase; verify against the real backend before
moving on, same as `BUILD.md` / `APP_BUILD.md`.

---

## PHASE A — In-match stats from existing data (frontend only)

No backend changes — `GET /matches/:id` already returns everything needed
(innings totals, batting cards, bowling cards, partnerships, tournament
rules via a join).

- **Current run rate**: `runs / (legalBalls / ballsPerOver)`, shown on
  every innings card once at least one legal ball has been bowled.
- **Required run rate** (innings 2+ only, while chasing): computed from
  `target`, runs so far, and balls remaining
  (`maxOvers * ballsPerOver - legalBalls`).
- **"Need N runs off M balls"** line during the chase.
- **Projected score** (innings 1, or innings 2 not yet chasing down): CRR
  extrapolated to `maxOvers`.
- **Fall of wickets**: derive cumulative score at each wicket by summing
  `partnerships[i].runs` up to and including wicket *i* (partnerships are
  already ordered by `wicket_number`); pair with the dismissed batter's
  name from the batting card's `dismissal_text`/`is_out`.
- **Extras breakdown**: the scorecard totals only expose a single
  `extras` sum — either accept that limitation for now or note it
  requires a backend change (do NOT silently reimplement extras
  categorization client-side from nothing; if the number isn't
  decomposable from existing fields, flag it rather than guess).
- **Toss summary line**: "`{winner}` won the toss, elected to
  `{decision}`" from `tossWinnerId`/`tossDecision`, already on
  `MatchDetail`.

**Verify:** open a live match with partial data (reuse the pattern from
Phase 3/5 — drive a few balls through the API against a fresh scheduled
match), confirm CRR/RRR/projected/fall-of-wickets match hand calculation.

---

## PHASE B — Delivery-level backend endpoint + charts

- New read route, e.g. `GET /matches/:id/deliveries` (or per-innings) —
  paginated or full list of non-voided deliveries for completed/live
  innings, going through the same public serializer discipline as
  everything else (no `suomisport_id` etc. — deliveries don't carry
  player names anyway, only IDs, so cross-reference client-side against
  already-fetched squad/scorecard data).
- Domain-pure helper (if any aggregation belongs in
  `backend/src/domain/**`) vs. plain SQL grouping — keep to the existing
  architecture rule: no scoring business logic reimplemented, this is
  pure data exposure.
- Flutter: Manhattan (runs per over, bar chart), Worm (cumulative runs,
  both innings overlaid once innings 2 exists), Wagon wheel (scatter/pie
  by `wagon_angle_deg`/`wagon_distance`, already captured per ball but
  currently write-only).
- Ball-by-ball commentary list (reverse-chronological), using the
  `commentary` free-text field already on each delivery plus a
  synthesized fallback ("4 runs", "OUT bowled", etc.) when commentary is
  empty.

**Verify:** score a few overs through the app (Phase 5 flow), confirm
Manhattan/Worm/wagon wheel match the deliveries actually posted.

---

## PHASE C — Match abandonment / no-result

- `matches.status` already has `abandoned`/`cancelled`/`forfeited` and
  `matches.result` already has `abandoned`/`no_result` as valid enum
  values in the schema — nothing currently writes them.
- New route, e.g. `POST /matches/:id/abandon` (organizer/scorer only,
  audit-logged like void), body: reason + resulting status/result.
- Standings service already *consumes* `no_result` for points
  purposes (`points_no_result`) — confirm it fires correctly once a
  match can actually reach that state.
- Flutter: an "Abandon match" action in the scoring menu with a reason
  prompt, and correct read-side display (result banner, standings row)
  for an abandoned match.

---

## PHASE D — Organiser rule editing

- New route, e.g. `PATCH /tournaments/:slug/rules` (organizer/platform
  admin only) — updates the 15 `tournament_rules` columns. Decide
  whether changes apply only to not-yet-started matches or also affect
  in-progress ones (recommend: not-yet-started only, to avoid silently
  changing bowler quota etc. mid-match).
- Flutter: a rules-editing screen reachable from tournament management,
  gated the same way as scoring actions.

---

## PHASE E — "CricHive Rain Rule" (done)

Official DLS tables are commercially licensed and can't be sourced or
reproduced here. Built as CricHive's own resource-based target-revision
method instead — explicitly and consistently labeled "CricHive Rain
Rule", never "DLS"/"D/L", anywhere in code, API responses, or UI copy.

- `backend/src/domain/rainRule/`: pure resource-percentage model
  (`resourcePercent(oversRemaining, wicketsLost, totalOvers)`, normalised
  per-format so any overs count works, not just 50) plus
  `computeRevisedTarget`/`computeParScore` (simple resource-ratio
  scaling — does not implement DLS's G50 average-score fallback for the
  rare case the chasing side ends up with more resource; documented
  simplification).
- `match_interruptions` table (append-only stoppage log, like
  `deliveries`) + `POST /matches/:id/innings/:n/interruption`
  (organizer/scorer, gated on `tournament_rules.dls_enabled`) — shrinks
  the innings' overs and, for innings 2+, overwrites its `target` in
  place so existing CRR/RRR display code needed no changes.
- Flutter: "Record rain interruption" scoring-menu action + an
  interruption-history banner on the match screen.

---

## Definition of done

- CRR/RRR/projected score/fall of wickets render correctly against real
  scored data, verified against hand calculation.
- Manhattan/Worm/wagon wheel render correctly from real posted
  deliveries.
- A match can be abandoned through the app and correctly shows as
  no-result in standings.
- An organiser can edit tournament rules through the app.
- A rain-affected chase gets a fair revised target via the CricHive Rain
  Rule, clearly distinguished from licensed DLS everywhere it appears.

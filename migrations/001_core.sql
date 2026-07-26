-- ============================================================
-- CricHive — Core Schema v1
-- PostgreSQL 15+
-- Target: Finn-Bangla Cricket Tournament 2026 (T10, 42 teams)
-- Designed to generalise to any Cricket Finland competition.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- 1. IDENTITY & ACCESS
-- ============================================================

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               CITEXT UNIQUE,
    phone               TEXT UNIQUE,
    password_hash       TEXT,
    google_sub          TEXT UNIQUE,
    display_name        TEXT NOT NULL,
    is_platform_admin   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    CONSTRAINT users_has_credential CHECK (
        password_hash IS NOT NULL OR google_sub IS NOT NULL
    )
);

-- Roles are scoped to a tournament, not global.
-- A person can be an organizer here and a scorer there.
CREATE TYPE tournament_role AS ENUM (
    'organizer',      -- full control of one tournament
    'scorer',         -- may score assigned matches
    'team_manager'    -- may edit own squad only
);

-- ============================================================
-- 2. PLAYERS
--
-- Players are created by organizers WITHOUT requiring an account.
-- suomisport_id is the identity key: 8-9 digit, lifelong, unique.
-- It is INTERNAL ONLY — never exposed on any public endpoint.
-- ============================================================

CREATE TYPE batting_style AS ENUM ('right_hand', 'left_hand');
CREATE TYPE bowling_style AS ENUM (
    'right_arm_fast', 'right_arm_medium', 'right_arm_offbreak', 'right_arm_legbreak',
    'left_arm_fast',  'left_arm_medium',  'left_arm_orthodox',  'left_arm_chinaman',
    'none'
);

CREATE TABLE players (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name           TEXT NOT NULL,
    display_name        TEXT,                    -- shown publicly; defaults to full_name
    suomisport_id       TEXT UNIQUE,             -- INTERNAL. Never serialise to public API.
    date_of_birth       DATE,
    batting             batting_style,
    bowling             bowling_style,
    photo_url           TEXT,

    -- A real user may later claim this profile and inherit its full history.
    claimed_by_user_id  UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    claimed_at          TIMESTAMPTZ,

    -- Duplicate resolution: losing record points at the surviving one.
    merged_into_id      UUID REFERENCES players(id),

    -- GDPR
    consent_recorded_by UUID REFERENCES users(id),
    consent_recorded_at TIMESTAMPTZ,
    is_minor            BOOLEAN NOT NULL DEFAULT FALSE,

    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT suomisport_id_format CHECK (
        suomisport_id IS NULL OR suomisport_id ~ '^[0-9]{8,9}$'
    ),
    CONSTRAINT not_merged_into_self CHECK (merged_into_id IS DISTINCT FROM id)
);

CREATE INDEX players_name_trgm ON players USING gin (full_name gin_trgm_ops);
CREATE INDEX players_active ON players (id) WHERE deleted_at IS NULL AND merged_into_id IS NULL;

-- ============================================================
-- 3. CLUBS & TEAMS
-- ============================================================

CREATE TABLE clubs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    city        TEXT,
    logo_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id     UUID REFERENCES clubs(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    short_name  TEXT,                   -- 3-4 chars for scorecards
    logo_url    TEXT,
    home_city   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. TOURNAMENTS, RULES, STAGES, GROUPS
--
-- Every format rule is data, not code. This is what lets the same
-- build run Finn-Bangla (T10) and Helsinki Cricket Cup (T20).
-- ============================================================

CREATE TYPE ball_type AS ENUM ('leather', 'tennis', 'tape');

CREATE TABLE tournaments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    season_year     SMALLINT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    organizer_org   TEXT,                       -- e.g. 'Cricket Finland'
    country_code    CHAR(2) NOT NULL DEFAULT 'FI',
    ball            ball_type NOT NULL DEFAULT 'leather',
    starts_on       DATE,
    ends_on         DATE,
    logo_url        TEXT,
    is_public       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tournament_rules (
    tournament_id           UUID PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
    overs_per_innings       SMALLINT NOT NULL,          -- Finn-Bangla: 10
    balls_per_over          SMALLINT NOT NULL DEFAULT 6,
    max_overs_per_bowler    SMALLINT NOT NULL,          -- T10: 2
    powerplay_overs         SMALLINT NOT NULL DEFAULT 3,
    players_per_side        SMALLINT NOT NULL DEFAULT 11,

    wide_runs               SMALLINT NOT NULL DEFAULT 1,
    noball_runs             SMALLINT NOT NULL DEFAULT 1,
    free_hit_after_noball   BOOLEAN  NOT NULL DEFAULT TRUE,

    points_win              SMALLINT NOT NULL DEFAULT 2,
    points_tie              SMALLINT NOT NULL DEFAULT 1,
    points_no_result        SMALLINT NOT NULL DEFAULT 1,
    points_loss             SMALLINT NOT NULL DEFAULT 0,
    bonus_point_enabled     BOOLEAN  NOT NULL DEFAULT FALSE,

    super_over_on_tie       BOOLEAN  NOT NULL DEFAULT TRUE,
    dls_enabled             BOOLEAN  NOT NULL DEFAULT FALSE,

    CONSTRAINT sane_overs CHECK (overs_per_innings BETWEEN 1 AND 50),
    CONSTRAINT sane_quota CHECK (max_overs_per_bowler BETWEEN 1 AND overs_per_innings)
);

CREATE TYPE stage_kind AS ENUM ('group', 'knockout', 'super_league', 'final');

CREATE TABLE stages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    kind            stage_kind NOT NULL,
    name            TEXT NOT NULL,              -- 'Group Stage', 'Quarter-Finals'
    sequence        SMALLINT NOT NULL,          -- ordering within tournament
    UNIQUE (tournament_id, sequence)
);

CREATE TABLE groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_id    UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,                  -- 'Group A'
    UNIQUE (stage_id, name)
);

CREATE TABLE group_teams (
    group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, team_id)
);

-- Which teams entered the tournament at all (42 for Finn-Bangla).
CREATE TABLE tournament_teams (
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tournament_id, team_id)
);

-- ============================================================
-- 4b. MEMBERSHIPS & SQUADS
-- Depend on tournaments/teams (above), so they're created here.
-- ============================================================

CREATE TABLE tournament_memberships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            tournament_role NOT NULL,
    team_id         UUID REFERENCES teams(id),   -- required for team_manager
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, user_id, role, team_id)
);

-- Squad = the pool a team may pick a playing XI from, per tournament.
CREATE TABLE team_squads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    jersey_number   SMALLINT,
    is_captain      BOOLEAN NOT NULL DEFAULT FALSE,
    is_keeper       BOOLEAN NOT NULL DEFAULT FALSE,

    -- Organizer manually verifies the Suomisport licence. We just record the check.
    licence_verified        BOOLEAN NOT NULL DEFAULT FALSE,
    licence_verified_by     UUID REFERENCES users(id),
    licence_verified_at     TIMESTAMPTZ,

    approved_at     TIMESTAMPTZ,        -- NULL while awaiting organizer approval
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tournament_id, team_id, player_id)
);

-- A player may not appear for two teams in the same tournament.
CREATE UNIQUE INDEX one_team_per_tournament
    ON team_squads (tournament_id, player_id);

-- ============================================================
-- 5. GROUNDS & SCHEDULING
-- With 42 teams the constraint is grounds x slots, not dates.
-- ============================================================

CREATE TABLE grounds (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    city        TEXT,
    latitude    NUMERIC(9,6),
    longitude   NUMERIC(9,6),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. MATCHES
-- ============================================================

CREATE TYPE match_status AS ENUM (
    'scheduled', 'toss_done', 'live', 'innings_break',
    'completed', 'abandoned', 'cancelled', 'forfeited'
);
CREATE TYPE match_result AS ENUM (
    'team_a_won', 'team_b_won', 'tie', 'no_result', 'abandoned'
);
CREATE TYPE toss_decision AS ENUM ('bat', 'bowl');

CREATE TABLE matches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id       UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    stage_id            UUID REFERENCES stages(id) ON DELETE SET NULL,
    group_id            UUID REFERENCES groups(id) ON DELETE SET NULL,
    match_number        INT,                     -- display order, 1..N

    team_a_id           UUID NOT NULL REFERENCES teams(id),
    team_b_id           UUID NOT NULL REFERENCES teams(id),

    ground_id           UUID REFERENCES grounds(id),
    scheduled_start     TIMESTAMPTZ,
    actual_start        TIMESTAMPTZ,

    -- Overs may be cut on the day (weather). Falls back to tournament_rules.
    overs_override      SMALLINT,

    status              match_status NOT NULL DEFAULT 'scheduled',
    toss_winner_id      UUID REFERENCES teams(id),
    toss_decision       toss_decision,

    result              match_result,
    winner_team_id      UUID REFERENCES teams(id),
    win_margin_runs     INT,
    win_margin_wickets  SMALLINT,
    result_note         TEXT,                    -- 'won by 5 wickets (D/L)'
    player_of_match_id  UUID REFERENCES players(id),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT teams_differ CHECK (team_a_id <> team_b_id)
);

CREATE INDEX matches_live ON matches (tournament_id) WHERE status IN ('live','innings_break','toss_done');
CREATE INDEX matches_schedule ON matches (scheduled_start);

-- Scorer assignment: who is allowed to write deliveries for this match.
CREATE TABLE match_scorers (
    match_id    UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_primary  BOOLEAN NOT NULL DEFAULT TRUE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, user_id)
);

-- Playing XI, chosen from team_squads at toss time.
CREATE TABLE match_players (
    match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id         UUID NOT NULL REFERENCES teams(id),
    player_id       UUID NOT NULL REFERENCES players(id),
    batting_order   SMALLINT,
    is_captain      BOOLEAN NOT NULL DEFAULT FALSE,
    is_keeper       BOOLEAN NOT NULL DEFAULT FALSE,
    is_substitute   BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (match_id, player_id)
);

-- ============================================================
-- 7. INNINGS & DELIVERIES  (the heart of the system)
--
-- Deliveries are an append-only event log. Every scorecard,
-- stat, partnership and points table is derived from this.
-- Nothing else is a source of truth.
-- ============================================================

CREATE TABLE innings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id            UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    innings_number      SMALLINT NOT NULL,       -- 1, 2; 3+ for super over
    batting_team_id     UUID NOT NULL REFERENCES teams(id),
    bowling_team_id     UUID NOT NULL REFERENCES teams(id),
    is_super_over       BOOLEAN NOT NULL DEFAULT FALSE,

    target              INT,                     -- set for innings 2
    max_overs           NUMERIC(4,1),            -- may be reduced mid-innings
    closed_at           TIMESTAMPTZ,

    UNIQUE (match_id, innings_number)
);

CREATE TYPE dismissal_kind AS ENUM (
    'bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket',
    'retired_hurt', 'retired_out', 'obstructing_the_field',
    'hit_ball_twice', 'timed_out'
);

CREATE TABLE deliveries (
    id                  BIGSERIAL PRIMARY KEY,
    innings_id          UUID NOT NULL REFERENCES innings(id) ON DELETE CASCADE,

    -- Idempotency: the scorer's device generates this before sending.
    -- Retries after a dropped connection are safely rejected as duplicates.
    client_event_id     UUID NOT NULL,

    over_number         SMALLINT NOT NULL,       -- 0-indexed
    ball_in_over        SMALLINT NOT NULL,       -- 1..6, excludes extras
    sequence            INT NOT NULL,            -- absolute order within innings

    striker_id          UUID NOT NULL REFERENCES players(id),
    non_striker_id      UUID NOT NULL REFERENCES players(id),
    bowler_id           UUID NOT NULL REFERENCES players(id),

    runs_off_bat        SMALLINT NOT NULL DEFAULT 0,
    extra_wides         SMALLINT NOT NULL DEFAULT 0,
    extra_noballs       SMALLINT NOT NULL DEFAULT 0,
    extra_byes          SMALLINT NOT NULL DEFAULT 0,
    extra_legbyes       SMALLINT NOT NULL DEFAULT 0,
    extra_penalty       SMALLINT NOT NULL DEFAULT 0,

    is_legal_delivery   BOOLEAN NOT NULL DEFAULT TRUE,   -- false for wide/no-ball
    is_free_hit         BOOLEAN NOT NULL DEFAULT FALSE,

    wicket_kind         dismissal_kind,
    player_out_id       UUID REFERENCES players(id),
    fielder_id          UUID REFERENCES players(id),

    -- Wagon wheel / pitch map. Optional, entered only if scorer taps.
    wagon_angle_deg     SMALLINT,
    wagon_distance      SMALLINT,

    commentary          TEXT,

    scored_by           UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Corrections are soft: a ball is voided, never deleted.
    voided_at           TIMESTAMPTZ,
    voided_by           UUID REFERENCES users(id),
    void_reason         TEXT,

    UNIQUE (innings_id, client_event_id),
    UNIQUE (innings_id, sequence),

    CONSTRAINT striker_differs CHECK (striker_id <> non_striker_id),
    CONSTRAINT wicket_consistent CHECK (
        (wicket_kind IS NULL AND player_out_id IS NULL)
        OR (wicket_kind IS NOT NULL AND player_out_id IS NOT NULL)
    ),
    CONSTRAINT runs_sane CHECK (runs_off_bat BETWEEN 0 AND 8)
);

CREATE INDEX deliveries_innings_seq ON deliveries (innings_id, sequence)
    WHERE voided_at IS NULL;
CREATE INDEX deliveries_batter ON deliveries (striker_id) WHERE voided_at IS NULL;
CREATE INDEX deliveries_bowler ON deliveries (bowler_id) WHERE voided_at IS NULL;

-- ============================================================
-- 8. DERIVED STATE
--
-- Recomputed from deliveries. Cached for read speed — a fan page
-- must never aggregate 120 rows per match across a season.
-- ============================================================

CREATE TABLE innings_totals (
    innings_id      UUID PRIMARY KEY REFERENCES innings(id) ON DELETE CASCADE,
    runs            INT NOT NULL DEFAULT 0,
    wickets         SMALLINT NOT NULL DEFAULT 0,
    legal_balls     INT NOT NULL DEFAULT 0,
    extras          INT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE batting_cards (
    innings_id      UUID NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
    player_id       UUID NOT NULL REFERENCES players(id),
    runs            INT NOT NULL DEFAULT 0,
    balls_faced     INT NOT NULL DEFAULT 0,
    fours           SMALLINT NOT NULL DEFAULT 0,
    sixes           SMALLINT NOT NULL DEFAULT 0,
    is_out          BOOLEAN NOT NULL DEFAULT FALSE,
    dismissal_text  TEXT,                       -- 'c Rahman b Islam'
    position        SMALLINT,
    PRIMARY KEY (innings_id, player_id)
);

CREATE TABLE bowling_cards (
    innings_id      UUID NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
    player_id       UUID NOT NULL REFERENCES players(id),
    legal_balls     INT NOT NULL DEFAULT 0,
    runs_conceded   INT NOT NULL DEFAULT 0,
    wickets         SMALLINT NOT NULL DEFAULT 0,
    maidens         SMALLINT NOT NULL DEFAULT 0,
    wides           SMALLINT NOT NULL DEFAULT 0,
    noballs         SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (innings_id, player_id)
);

CREATE TABLE partnerships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    innings_id      UUID NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
    wicket_number   SMALLINT NOT NULL,
    player_a_id     UUID NOT NULL REFERENCES players(id),
    player_b_id     UUID NOT NULL REFERENCES players(id),
    runs            INT NOT NULL DEFAULT 0,
    balls           INT NOT NULL DEFAULT 0,
    UNIQUE (innings_id, wicket_number)
);

-- Points table, per group. Recomputed on match completion.
CREATE TABLE standings (
    group_id            UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    team_id             UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    played              SMALLINT NOT NULL DEFAULT 0,
    won                 SMALLINT NOT NULL DEFAULT 0,
    lost                SMALLINT NOT NULL DEFAULT 0,
    tied                SMALLINT NOT NULL DEFAULT 0,
    no_result           SMALLINT NOT NULL DEFAULT 0,
    points              SMALLINT NOT NULL DEFAULT 0,
    runs_for            INT NOT NULL DEFAULT 0,
    balls_faced         INT NOT NULL DEFAULT 0,
    runs_against        INT NOT NULL DEFAULT 0,
    balls_bowled        INT NOT NULL DEFAULT 0,
    net_run_rate        NUMERIC(6,3) NOT NULL DEFAULT 0,
    rank                SMALLINT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, team_id)
);

-- Career aggregates across all tournaments. Powers player profile pages.
CREATE TABLE player_career_stats (
    player_id           UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    matches             INT NOT NULL DEFAULT 0,
    innings_batted      INT NOT NULL DEFAULT 0,
    runs                INT NOT NULL DEFAULT 0,
    balls_faced         INT NOT NULL DEFAULT 0,
    highest_score       INT NOT NULL DEFAULT 0,
    not_outs            INT NOT NULL DEFAULT 0,
    fifties             INT NOT NULL DEFAULT 0,
    hundreds            INT NOT NULL DEFAULT 0,
    fours               INT NOT NULL DEFAULT 0,
    sixes               INT NOT NULL DEFAULT 0,
    innings_bowled      INT NOT NULL DEFAULT 0,
    legal_balls_bowled  INT NOT NULL DEFAULT 0,
    runs_conceded       INT NOT NULL DEFAULT 0,
    wickets             INT NOT NULL DEFAULT 0,
    best_bowling_wkts   SMALLINT NOT NULL DEFAULT 0,
    best_bowling_runs   INT,
    catches             INT NOT NULL DEFAULT 0,
    stumpings           INT NOT NULL DEFAULT 0,
    run_outs            INT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 9. AUDIT & GDPR
-- The thing CricHeroes gets complaints about. Build it in from day one.
-- ============================================================

CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    actor_user_id   UUID REFERENCES users(id),
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    action          TEXT NOT NULL,          -- 'create','update','void','merge','delete'
    before_state    JSONB,
    after_state     JSONB,
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_entity ON audit_log (entity_type, entity_id, created_at DESC);

-- A player (or guardian) asking for correction or erasure.
CREATE TYPE data_request_kind AS ENUM ('correction', 'erasure', 'access', 'objection');
CREATE TYPE data_request_status AS ENUM ('open', 'in_progress', 'resolved', 'rejected');

CREATE TABLE data_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id       UUID REFERENCES players(id) ON DELETE SET NULL,
    raised_by_email TEXT NOT NULL,
    kind            data_request_kind NOT NULL,
    details         TEXT,
    status          data_request_status NOT NULL DEFAULT 'open',
    handled_by      UUID REFERENCES users(id),
    resolution_note TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

-- ============================================================
-- NOTES
--
-- 1. tournament_memberships and team_squads are created in section 4b,
--    after tournaments and teams, so no table references one defined
--    later in this file.
--
-- 2. deliveries is append-only. Corrections void a row and append a
--    replacement. This gives a full history and makes the "wrong score"
--    dispute solvable — the single loudest complaint about CricHeroes.
--
-- 3. suomisport_id must be stripped in the public API serializer layer.
--    Enforce with a dedicated read-only DB role that lacks column access.
--
-- 4. Host in eu-north-1 (Stockholm). Finnish personal data, EU controller.
-- ============================================================

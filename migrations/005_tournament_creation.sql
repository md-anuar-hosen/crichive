-- ============================================================
-- CricHive — Self-serve tournament creation
--
-- Until now, `tournaments` and `tournament_memberships` were only ever
-- written by the seed script — there was no way for a real user to
-- create a tournament or become its organizer. This adds that, with a
-- platform-wide switch: organizer signup can be fully open (anyone who
-- creates a tournament becomes its organizer immediately) or gated
-- behind platform-admin approval, same "NULL while pending" pattern
-- already used for team_squads.approved_at.
-- ============================================================

-- Singleton settings row — a CHECK on a boolean primary key is the
-- standard Postgres idiom for "this table only ever has one row".
CREATE TABLE platform_settings (
    id                      BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    organizer_signup_mode   TEXT NOT NULL DEFAULT 'open' CHECK (organizer_signup_mode IN ('open', 'approval_required')),
    updated_by              UUID REFERENCES users(id),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (id) VALUES (TRUE);

-- NULL while awaiting platform-admin approval (only reachable when
-- organizer_signup_mode = 'approval_required' at creation time).
-- DEFAULT now() backfills every pre-existing (seeded) tournament as
-- already-approved; the default is dropped immediately after so future
-- inserts must set this explicitly based on the mode at creation time.
ALTER TABLE tournaments
    ADD COLUMN approved_at TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN approved_by UUID REFERENCES users(id);

ALTER TABLE tournaments ALTER COLUMN approved_at DROP DEFAULT;

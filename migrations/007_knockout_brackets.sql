-- Knockout brackets. stage_kind already had 'knockout'/'final' since the
-- first migration but nothing ever created matches for them.
--
-- team_a_id/team_b_id must become nullable: a bracket match beyond round 1
-- is created before both its participants are known (they're filled in as
-- earlier matches are decided or byes are resolved). teams_differ already
-- tolerates NULLs (SQL: NULL <> anything is NULL, which a CHECK treats as
-- satisfied), so it needs no change.
ALTER TABLE matches ALTER COLUMN team_a_id DROP NOT NULL;
ALTER TABLE matches ALTER COLUMN team_b_id DROP NOT NULL;

ALTER TABLE matches
    ADD COLUMN next_match_id   UUID REFERENCES matches(id) ON DELETE SET NULL,
    ADD COLUMN next_match_slot TEXT CHECK (next_match_slot IN ('team_a', 'team_b')),
    ADD COLUMN bracket_round   SMALLINT,   -- 1 = first round, increasing toward the final
    ADD COLUMN bracket_seed_a  SMALLINT,   -- seed number placed in team_a_id, for display before it's filled
    ADD COLUMN bracket_seed_b  SMALLINT;

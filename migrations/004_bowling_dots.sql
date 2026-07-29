-- ============================================================
-- CricHive — Bowling dot-ball count
--
-- Cricbuzz-style bowling figures show dot balls ("D") alongside
-- overs/maidens/runs/wickets. Add the derived column; backfilled by the
-- normal delivery-scoring path (applyScorecardToDerivedTables), same as
-- every other bowling_cards column.
-- ============================================================

ALTER TABLE bowling_cards ADD COLUMN dots SMALLINT NOT NULL DEFAULT 0;

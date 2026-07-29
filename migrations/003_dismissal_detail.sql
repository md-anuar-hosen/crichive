-- ============================================================
-- CricHive — Dismissal detail cleanup
--
-- batting_cards.dismissal_text was only ever populated with the raw
-- dismissal_kind ("caught", "bowled", ...), never a real scorecard
-- string like "c Rahman b Islam" — the bowler/fielder info needed for
-- that already exists on `deliveries` (bowler_id, fielder_id,
-- player_out_id, wicket_kind), which is the single source of truth.
-- Drop the dead column; the display string is now composed at read
-- time in matchScorecard.ts from `deliveries` + `players`.
-- ============================================================

ALTER TABLE batting_cards DROP COLUMN dismissal_text;

-- ============================================================
-- CricHive — Rain Rule (Phase E)
--
-- "CricHive Rain Rule" is our own resource-based target-revision
-- method for interrupted innings — inspired by the published academic
-- description of the Duckworth-Lewis approach (resource% by overs
-- remaining x wickets lost), but independently parameterised. It is
-- NOT the licensed ICC/ECB Duckworth-Lewis-Stern method and must
-- never be labelled "DLS" or "D/L" in code, UI copy, or API output.
--
-- Each interruption is an append-only event, same spirit as
-- `deliveries`: we never rewrite history, only record what happened
-- and let services derive the current revised target from the log.
-- ============================================================

CREATE TABLE match_interruptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    innings_id              UUID NOT NULL REFERENCES innings(id) ON DELETE CASCADE,

    -- Overs left in this innings (relative to its max_overs at the time),
    -- before and after the stoppage. Resource lost is derived from these
    -- plus wickets_lost_at via the resource table in the domain layer.
    overs_remaining_before  NUMERIC(4,1) NOT NULL,
    overs_remaining_after   NUMERIC(4,1) NOT NULL,
    wickets_lost_at         SMALLINT NOT NULL,

    reason                  TEXT,
    recorded_by             UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT overs_after_le_before CHECK (overs_remaining_after <= overs_remaining_before),
    CONSTRAINT overs_nonnegative CHECK (overs_remaining_before >= 0 AND overs_remaining_after >= 0),
    CONSTRAINT wickets_lost_sane CHECK (wickets_lost_at BETWEEN 0 AND 10)
);

CREATE INDEX match_interruptions_innings ON match_interruptions (innings_id, created_at);

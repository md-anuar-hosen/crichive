-- Adds a distinct match_status so the UI can show "Super Over" rather than a
-- generic "innings break" while the extra innings (numbers 3 and 4; see the
-- innings.innings_number comment from 001_core.sql) are being scored.
ALTER TYPE match_status ADD VALUE 'super_over';

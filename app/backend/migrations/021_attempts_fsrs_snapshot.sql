-- Migration 021: Snapshot do card FSRS antes da tentativa para retificação determinística
ALTER TABLE attempts ADD COLUMN fsrs_card_before TEXT;
ALTER TABLE attempts ADD COLUMN fsrs_reviewed_at TEXT;
ALTER TABLE attempts ADD COLUMN twin_card_before TEXT;
ALTER TABLE attempts ADD COLUMN twin_reviewed_at TEXT;

-- Migration 017: Anotações/grifos pessoais por questão (Caderno Inteligente) e presets de filtros salvos
CREATE TABLE IF NOT EXISTS question_user_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    question_id INTEGER NOT NULL,
    highlights_json TEXT NOT NULL DEFAULT '[]',
    note_text TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_q_user_notes_user ON question_user_notes(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS study_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    filters_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_study_presets_user ON study_presets(user_id, updated_at DESC);

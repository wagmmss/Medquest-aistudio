-- Migration 016: Índices compostos por user_id para acelerar queries de stats, FSRS e perfil adaptativo
CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY,
    question_id INTEGER,
    user_id INTEGER DEFAULT 1,
    answered_at TEXT
);

CREATE TABLE IF NOT EXISTS spaced_repetition (
    id INTEGER PRIMARY KEY,
    question_id INTEGER,
    user_id INTEGER DEFAULT 1,
    next_review_date TEXT
);

CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY,
    question_id INTEGER,
    user_id INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_answered ON attempts(user_id, answered_at, question_id);
CREATE INDEX IF NOT EXISTS idx_srs_user_due ON spaced_repetition(user_id, next_review_date, question_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_qid ON favorites(user_id, question_id);

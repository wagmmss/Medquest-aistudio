CREATE TABLE IF NOT EXISTS lesson_cycle_settings (
    user_id TEXT PRIMARY KEY,
    default_pre_questions INTEGER NOT NULL DEFAULT 5 CHECK (default_pre_questions >= 0 AND default_pre_questions <= 30),
    default_post_questions INTEGER NOT NULL DEFAULT 25 CHECK (default_post_questions >= 1 AND default_post_questions <= 100),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lesson_study_cycle (
    user_id TEXT NOT NULL,
    subtema TEXT NOT NULL,
    pre_target INTEGER NOT NULL DEFAULT 5,
    pre_completed INTEGER NOT NULL DEFAULT 0,
    pre_correct INTEGER NOT NULL DEFAULT 0,
    pre_done INTEGER NOT NULL DEFAULT 0 CHECK (pre_done IN (0, 1)),
    pre_completed_at TEXT,
    post_target INTEGER NOT NULL DEFAULT 25,
    post_completed INTEGER NOT NULL DEFAULT 0,
    post_correct INTEGER NOT NULL DEFAULT 0,
    post_done INTEGER NOT NULL DEFAULT 0 CHECK (post_done IN (0, 1)),
    post_completed_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, subtema)
);

CREATE INDEX IF NOT EXISTS idx_lesson_study_cycle_user ON lesson_study_cycle(user_id);

CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_key TEXT NOT NULL,
    course_name TEXT NOT NULL,
    is_extra INTEGER NOT NULL DEFAULT 0 CHECK (is_extra IN (0, 1)),
    area TEXT NOT NULL DEFAULT 'Extras',
    specialty TEXT NOT NULL DEFAULT '',
    subtema TEXT,
    module_name TEXT NOT NULL,
    module_order INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    lesson_order INTEGER NOT NULL DEFAULT 0,
    lesson_kind TEXT NOT NULL DEFAULT 'aula',
    is_essential INTEGER NOT NULL DEFAULT 1 CHECK (is_essential IN (0, 1)),
    media_type TEXT NOT NULL DEFAULT 'video',
    provider TEXT NOT NULL DEFAULT 'gdrive',
    drive_file_id TEXT NOT NULL UNIQUE,
    drive_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lesson_progress (
    user_id TEXT NOT NULL,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
    bookmark_seconds INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lessons_course_area ON lessons(course_key, active, area, module_order, lesson_order);
CREATE INDEX IF NOT EXISTS idx_lessons_subtema ON lessons(subtema, active, is_extra, lesson_order);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(user_id, status);

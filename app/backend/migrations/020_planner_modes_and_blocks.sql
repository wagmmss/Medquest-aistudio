-- Expande os modos permitidos em planner_schedule para suportar organização (geral/internato) + intensivo
CREATE TABLE IF NOT EXISTS planner_schedule_new (
    user_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'geral_standard' CHECK (
        mode IN (
            'standard',
            'intensive',
            'geral_standard',
            'geral_intensive',
            'internato_standard',
            'internato_intensive'
        )
    ),
    week INTEGER NOT NULL,
    subtema TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, mode, week, subtema)
);

INSERT OR IGNORE INTO planner_schedule_new (user_id, mode, week, subtema, display_order, created_at)
SELECT user_id, mode, week, subtema, display_order, created_at FROM planner_schedule;

DROP TABLE IF EXISTS planner_schedule;
ALTER TABLE planner_schedule_new RENAME TO planner_schedule;

CREATE INDEX IF NOT EXISTS idx_planner_schedule_lookup
ON planner_schedule(user_id, mode, week, display_order);

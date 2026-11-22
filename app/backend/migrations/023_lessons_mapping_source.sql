ALTER TABLE lessons ADD COLUMN mapping_source TEXT NOT NULL DEFAULT 'auto' CHECK (mapping_source IN ('auto', 'manual'));

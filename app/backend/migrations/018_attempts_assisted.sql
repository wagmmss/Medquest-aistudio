-- Migration 018: Marcação de tentativa assistida por Dica do Preceptor (/dica) antes da resposta
ALTER TABLE attempts ADD COLUMN assisted INTEGER NOT NULL DEFAULT 0;

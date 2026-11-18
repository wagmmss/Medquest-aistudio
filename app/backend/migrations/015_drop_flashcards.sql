-- Remove permanentemente a tabela legada de flashcards e seus índices.
DROP INDEX IF EXISTS idx_flashcards_user_review;
DROP INDEX IF EXISTS idx_flashcards_user_deck;
DROP INDEX IF EXISTS idx_flashcards_user_anki_nid;
DROP INDEX IF EXISTS idx_flashcards_user_anki_cid;
DROP TABLE IF EXISTS flashcards;

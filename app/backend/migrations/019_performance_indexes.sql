-- Migration 019: Índices compostos de performance para estatísticas de alternativas, tentativas e filtros de questões
CREATE INDEX IF NOT EXISTS idx_attempts_question_letter ON attempts(question_id, selected_letter);
CREATE INDEX IF NOT EXISTS idx_attempts_user_answered ON attempts(user_id, answered_at, question_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_qid_latest_cov ON attempts(user_id, question_id, id DESC, is_correct, answered_at);
CREATE INDEX IF NOT EXISTS idx_attempts_user_correct_qid ON attempts(user_id, is_correct, question_id, selected_letter);
CREATE INDEX IF NOT EXISTS idx_questions_active_area_subtema ON questions(missing_alts, area, subtema, institution_code);
CREATE INDEX IF NOT EXISTS idx_questions_active_inst_year ON questions(missing_alts, institution_code, year);
CREATE INDEX IF NOT EXISTS idx_alternatives_qid_correct_letter ON alternatives(question_id, is_correct, letter);

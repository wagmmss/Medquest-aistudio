# 🎯 MedQuest - Progresso e Backlog de Engenharia Autônoma

### STATUS: ATIVO

> **Diretrizes de Segurança do Autoloop**:
> 1. Todas as alterações ocorrem na branch `autoloop/dev`. A `main` e a produção (`medquest.live` / Render) estão 100% protegidas.
> 2. Valide cada mudança com `./validate.sh fast` antes de dar a tarefa como concluída.
> 3. Não modifique `app/frontend/src/proxy.ts`, `app/backend/api/db.py` ou credenciais do Clerk.
> 4. Nunca faça alterações automáticas em bancos de produção (Turso Cloud).
> 5. Respeite a calibração do algoritmo FSRS v6 (retenção 0.85 e intervalos com piso D+1).

---

## 🔄 Próxima Tarefa em Andamento

- Nenhuma tarefa pendente no momento — backlog prioritário concluído e validado.

---

## 📋 Backlog Prioritário (Tarefas Cirúrgicas)

1. [x] **Rastreamento de Acerto Assistido (`assisted`) na Tentativa e FSRS (`app/backend/api/questions.py`, `app/backend/api/srs.py`, `QuizClient.tsx`)**
2. [x] **Criação de Sessão por Linguagem Natural (`app/frontend/src/app/estudar/components/QuizFilters.tsx`, `src/lib/naturalSessionParser.ts`)**
3. [x] **Botão `Treinar (10q)` por Tema em Cobertura, Drawer, Pontos Fracos e Foco (`CoverageThemesTab.tsx`, `ThemeDetailDrawer.tsx`, `FocusRadarTab.tsx`, `PerformanceRadarTab.tsx`)**
4. [x] **Ocultar Estatísticas de Alternativas Antes/Durante a Revisão (`app/frontend/src/app/estudar/components/AlternativeList.tsx`)**

---

## 💡 Sugestões de Melhorias Futuras (Buffer Recente)

- Benchmark automatizado de carga para endpoints de fila adaptativa e remediação.
- Auditoria de contraste WCAG AAA nos badges de subtemas clínicos.
- Purga seletiva de imagens médicas no Cache Storage (`medquest-image-cache`) em saturação de disco.
- Exportação de caderno de erros em formato offline portátil com gabarito comentado congelado.
- Seção "Últimas sessões e artigos/questões consultadas" com retomada rápida em `/buscar`.

> 💡 Catálogo completo de sugestões arquivado em [docs/SUGESTOES_FUTURAS.md](docs/SUGESTOES_FUTURAS.md)

---

## ✅ Última Tarefa Concluída

- [x] **Acerto Assistido (`assisted`), Sessão por Linguagem Natural, Treino Direto (10q), Toggle Anti-Viés em Alternativas e Auditoria Clinical Calm (2026-11-17)**: Implementado rastreamento completo de tentativas assistidas por `/dica` (calibração FSRS para `Rating.Hard`, migração `018_attempts_assisted.sql`, diferenciação `Correto` vs `Correto com ajuda` em `/analise` e no resumo de sessão), construtor de bateria em linguagem natural PT-BR (`naturalSessionParser.ts` + `QuizFilters.tsx`), ação direta `Treinar (10q)` em todas as abas de `/analise`, toggle persistido em `localStorage` para ocultar estatísticas/histórico das alternativas em `AlternativeList.tsx`, e normalização de tokens semânticos Clinical Calm em `globals.css`.

> 📁 Histórico completo arquivado em [CHANGELOG.md](CHANGELOG.md)


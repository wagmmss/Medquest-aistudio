"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, X, FileText, StickyNote, ArrowRight, Compass, PlayCircle, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useLessonsAccess } from "@/hooks/useLessonsAccess";
import { buildLessonReturnUrl } from "@/lib/themeJourney";

function formatShortDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const QUICK_ROUTES = [
  { label: "Estudar Questões (Montar Bateria)", href: "/estudar", tag: "Questões" },
  { label: "Aulas em Vídeo (Extensivo + MedCof)", href: "/aulas", tag: "Aulas", requiresLessonsAccess: true },
  { label: "Caderno Inteligente (Meus Macetes)", href: "/caderno", tag: "Caderno" },
  { label: "Provas na Íntegra & Simulados", href: "/simulado", tag: "Provas" },
  { label: "Raio-X Sniper & Domínio de Focos", href: "/analise?tab=sniper", tag: "Sniper" },
  { label: "Planner Modo Reta Final", href: "/planner?intensive=true", tag: "Planner" },
  { label: "Simulador OSCE (2ª Fase)", href: "/osce", tag: "OSCE" },
];

export function openCommandPalette() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("open-command-palette"));
  }
}

export function CommandPalette() {
  const router = useRouter();
  const { canAccessLessons } = useLessonsAccess();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    const onOpenEvent = () => setIsOpen(true);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const trimmed = query.trim();

  const { data: examsData } = useQuery({
    queryKey: ["command-palette-exams"],
    queryFn: () => api.questions.getOfficialExams(true),
    enabled: isOpen,
    staleTime: 5 * 60_000,
  });

  const { data: notesData } = useQuery({
    queryKey: ["command-palette-notes", trimmed],
    queryFn: ({ signal }) => api.notes.list({ q: trimmed }, signal),
    enabled: isOpen && trimmed.length >= 2,
    staleTime: 30_000,
  });

  const { data: lessonNotesData } = useQuery({
    queryKey: ["command-palette-lesson-notes", trimmed],
    queryFn: ({ signal }) => api.lessons.listNotes({ q: trimmed }, signal),
    enabled: isOpen && canAccessLessons && trimmed.length >= 2,
    staleTime: 30_000,
  });

  const { data: lessonsData, isFetching: searchingLessons } = useQuery({
    queryKey: ["command-palette-lessons", trimmed],
    queryFn: ({ signal }) => api.lessons.list({ q: trimmed, limit: 5 }, signal),
    enabled: isOpen && canAccessLessons && trimmed.length >= 2,
    staleTime: 30_000,
  });

  const { data: searchData, isFetching: searchingQuestions } = useQuery({
    queryKey: ["command-palette-questions", trimmed],
    queryFn: ({ signal }) => api.questions.search(trimmed, { limit: 6 }, signal),
    enabled: isOpen && trimmed.length >= 3,
    staleTime: 30_000,
  });

  const matchingRoutes = useMemo(() => {
    const allowed = QUICK_ROUTES.filter((r) => !r.requiresLessonsAccess || canAccessLessons);
    if (!trimmed) return allowed;
    const lower = trimmed.toLowerCase();
    return allowed.filter(
      (r) => r.label.toLowerCase().includes(lower) || r.tag.toLowerCase().includes(lower)
    );
  }, [trimmed, canAccessLessons]);

  const matchingExams = useMemo(() => {
    const exams = examsData?.exams ?? [];
    if (!trimmed) return [];
    const lower = trimmed.toLowerCase();
    const out: Array<{ label: string; href: string }> = [];
    for (const ex of exams) {
      for (const ed of ex.editions) {
        const label = `${ex.name} ${ed.year} (${ed.recommended_questions}Q)`;
        if (
          label.toLowerCase().includes(lower) ||
          ex.institution_code.toLowerCase().includes(lower)
        ) {
          out.push({
            label,
            href: `/simulado?institution=${encodeURIComponent(ex.institution_code)}&year=${ed.year}`,
          });
        }
        if (out.length >= 5) return out;
      }
    }
    return out;
  }, [examsData, trimmed]);

  const matchingNotes = (notesData?.notes ?? []).slice(0, 4);
  const matchingLessonNotes = canAccessLessons ? (lessonNotesData?.notes ?? []).slice(0, 4) : [];
  const matchingLessons = canAccessLessons ? (lessonsData?.lessons ?? []).slice(0, 5) : [];
  const totalMatchingLessons = canAccessLessons ? (lessonsData?.summary?.total ?? matchingLessons.length) : 0;
  const matchingQuestions = (searchData ?? []).slice(0, 5);

  const navigate = (href: string) => {
    setIsOpen(false);
    setQuery("");
    router.push(href);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-start justify-center pt-4 sm:pt-20 px-2.5 sm:px-4"
      onClick={() => setIsOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Busca Global Inteligente"
    >
      <div
        className="w-full max-w-2xl bg-surface border border-line-subtle rounded-md shadow-2xl overflow-hidden flex flex-col max-h-[85dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-3.5 sm:px-4 py-2.5 border-b border-line-subtle">
          <Search className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={
              canAccessLessons
                ? "Buscar aulas, provas, macetes, temas ou questões"
                : "Buscar provas, macetes, temas ou questões"
            }
            placeholder={
              canAccessLessons
                ? "Buscar aulas, provas (ex: USP 2025), macetes, temas ou questões..."
                : "Buscar provas (ex: USP 2025), macetes do caderno, temas ou questões..."
            }
            className="flex-1 bg-transparent text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Fechar busca"
            className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xs text-ink-muted hover:text-ink-primary hover:bg-elevated cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-3 flex flex-col gap-4">
          {matchingRoutes.length > 0 && (
            <section className="flex flex-col gap-1">
              <span className="px-2 text-[10px] font-mono-lab uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
                <Compass className="w-3 h-3" /> Navegação Rápida
              </span>
              {matchingRoutes.map((route) => (
                <button
                  key={route.href}
                  type="button"
                  onClick={() => navigate(route.href)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xs hover:bg-elevated text-left text-xs text-ink-primary cursor-pointer"
                >
                  <span className="font-medium">{route.label}</span>
                  <span className="text-[10px] font-mono-lab px-1.5 py-0.5 rounded-xs bg-canvas border border-line-subtle text-ink-muted">
                    {route.tag}
                  </span>
                </button>
              ))}
            </section>
          )}

          {matchingExams.length > 0 && (
            <section className="flex flex-col gap-1">
              <span className="px-2 text-[10px] font-mono-lab uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> Provas na Íntegra
              </span>
              {matchingExams.map((ex) => (
                <button
                  key={ex.href}
                  type="button"
                  onClick={() => navigate(ex.href)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xs hover:bg-elevated text-left text-xs text-ink-primary cursor-pointer"
                >
                  <span>{ex.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-ink-muted" />
                </button>
              ))}
            </section>
          )}

          {(matchingNotes.length > 0 || matchingLessonNotes.length > 0) && (
            <section className="flex flex-col gap-1">
              <span className="px-2 text-[10px] font-mono-lab uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
                <StickyNote className="w-3 h-3" /> Caderno Inteligente
              </span>
              {matchingLessonNotes.map((ln) => (
                <button
                  key={`ln-${ln.lesson_id}`}
                  type="button"
                  onClick={() => navigate(`/caderno`)}
                  className="w-full flex flex-col gap-0.5 px-3 py-2 rounded-xs hover:bg-elevated text-left cursor-pointer"
                >
                  <span className="text-xs font-semibold text-ink-primary">
                    Aula • {ln.subtema || ln.title}
                  </span>
                  <span className="text-[11px] text-ink-secondary line-clamp-1">
                    {ln.notes}
                  </span>
                </button>
              ))}
              {matchingNotes.map((n) => (
                <button
                  key={`qn-${n.question_id}`}
                  type="button"
                  onClick={() => navigate(`/caderno`)}
                  className="w-full flex flex-col gap-0.5 px-3 py-2 rounded-xs hover:bg-elevated text-left cursor-pointer"
                >
                  <span className="text-xs font-semibold text-ink-primary">
                    Q#{n.question_id} • {n.subtema || n.area || "Anotação"}
                  </span>
                  <span className="text-[11px] text-ink-secondary line-clamp-1">
                    {n.note_text || n.highlights?.[0]?.text || n.stem_preview}
                  </span>
                </button>
              ))}
            </section>
          )}

          {canAccessLessons && trimmed.length >= 2 && (searchingLessons || matchingLessons.length > 0) && (
            <section className="flex flex-col gap-1">
              <div className="px-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono-lab uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
                  <PlayCircle className="w-3 h-3" />
                  Aulas {searchingLessons ? "(buscando...)" : `(${totalMatchingLessons})`}
                </span>
                {totalMatchingLessons > matchingLessons.length && (
                  <button
                    type="button"
                    onClick={() => navigate(`/buscar?q=${encodeURIComponent(trimmed)}&scope=aulas`)}
                    className="text-[10px] font-semibold text-accent hover:underline cursor-pointer"
                  >
                    Ver todas ({totalMatchingLessons})
                  </button>
                )}
              </div>
              {matchingLessons.map((lesson) => {
                const dur = formatShortDuration(lesson.duration_seconds);
                const isDone = lesson.progress.status === "completed";
                return (
                  <button
                    key={lesson.id}
                    type="button"
                    onClick={() =>
                      navigate(
                        buildLessonReturnUrl({
                          lessonId: lesson.id,
                          subtema: lesson.subtema,
                        })
                      )
                    }
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xs hover:bg-elevated text-left cursor-pointer"
                  >
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-ink-primary line-clamp-1">
                        {lesson.title}
                      </span>
                      <span className="text-[11px] font-mono-lab text-ink-secondary line-clamp-1">
                        {lesson.course_name} • {lesson.subtema || lesson.module_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-success" />}
                      {dur && (
                        <span className="text-[10px] font-mono-lab px-1.5 py-0.5 rounded-xs bg-canvas border border-line-subtle text-ink-muted tabular-nums">
                          {dur}
                        </span>
                      )}
                      <ArrowRight className="w-3.5 h-3.5 text-ink-muted" />
                    </div>
                  </button>
                );
              })}
            </section>
          )}

          {trimmed.length >= 3 && (
            <section className="flex flex-col gap-1">
              <span className="px-2 text-[10px] font-mono-lab uppercase tracking-wider text-ink-muted">
                Questões {searchingQuestions ? "(buscando...)" : `(${matchingQuestions.length})`}
              </span>
              {matchingQuestions.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => navigate(`/buscar?q=${encodeURIComponent(trimmed)}`)}
                  className="w-full flex flex-col gap-0.5 px-3 py-2 rounded-xs hover:bg-elevated text-left cursor-pointer"
                >
                  <span className="text-[11px] font-mono-lab text-accent">
                    {q.institution_code} {q.year} • {q.subtema || q.area}
                  </span>
                  <span className="text-xs text-ink-primary line-clamp-1">
                    {q.stem_snippet.replace(/<[^>]+>/g, "")}
                  </span>
                </button>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

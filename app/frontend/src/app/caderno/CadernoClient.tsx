"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Search,
  Trash2,
  BookOpen,
  Highlighter,
  StickyNote,
  ArrowUpRight,
  PlayCircle,
  Clock,
  Pencil,
  Check,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { useLessonsAccess } from "@/hooks/useLessonsAccess";
import { buildLessonReturnUrl } from "@/lib/themeJourney";
import { LessonUserNote, QuestionUserNote } from "@/types/api";

type NotebookTab = "all" | "lessons" | "questions";

const BASE_AREAS = [
  "Clínica Médica",
  "Cirurgia",
  "Ginecologia e Obstetrícia",
  "Pediatria",
  "Medicina Preventiva",
];

const LESSON_EXTRA_AREAS = ["Prática / OSCE", "Radiologia"];

function formatBookmark(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatUpdatedDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

type UnifiedNoteItem =
  | { kind: "lesson"; updatedAt: string; data: LessonUserNote }
  | { kind: "question"; updatedAt: string; data: QuestionUserNote };

export function CadernoClient() {
  const queryClient = useQueryClient();
  const { canAccessLessons } = useLessonsAccess();
  const [areaFilter, setAreaFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<NotebookTab>("all");
  const [editingLessonId, setEditingLessonId] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  const effectiveTab: NotebookTab = canAccessLessons ? activeTab : "questions";
  const areaOptions = useMemo(
    () => (canAccessLessons ? [...BASE_AREAS, ...LESSON_EXTRA_AREAS] : BASE_AREAS),
    [canAccessLessons]
  );

  const {
    data: questionNotesData,
    isLoading: loadingQuestionNotes,
    isError: isQuestionNotesError,
  } = useQuery({
    queryKey: ["smart-notebook", areaFilter, searchTerm],
    queryFn: ({ signal }) =>
      api.notes.list({ area: areaFilter || undefined, q: searchTerm || undefined }, signal),
    staleTime: 60_000,
  });

  const {
    data: lessonNotesData,
    isLoading: loadingLessonNotes,
    isError: isLessonNotesError,
  } = useQuery({
    queryKey: ["smart-notebook-lessons", areaFilter, searchTerm],
    queryFn: ({ signal }) =>
      api.lessons.listNotes({ area: areaFilter || undefined, q: searchTerm || undefined }, signal),
    enabled: canAccessLessons,
    staleTime: 60_000,
  });

  const deleteQuestionNoteMutation = useMutation({
    mutationFn: (qid: number) => api.notes.remove(qid),
    onSuccess: () => {
      toast.success("Anotação removida do Caderno.");
      void queryClient.invalidateQueries({ queryKey: ["smart-notebook"] });
    },
    onError: () => {
      toast.error("Não foi possível remover a anotação.");
    },
  });

  const updateLessonNoteMutation = useMutation({
    mutationFn: ({ lessonId, notes }: { lessonId: number; notes: string }) =>
      api.lessons.saveProgress(lessonId, { notes }),
    onSuccess: (_res, vars) => {
      const removed = !vars.notes.trim();
      toast.success(removed ? "Anotação da aula removida." : "Anotação da aula atualizada.");
      setEditingLessonId(null);
      setEditingDraft("");
      void queryClient.invalidateQueries({ queryKey: ["smart-notebook-lessons"] });
      void queryClient.invalidateQueries({ queryKey: ["lesson-detail", vars.lessonId] });
      void queryClient.invalidateQueries({ queryKey: ["lessons"] });
    },
    onError: () => {
      toast.error("Não foi possível salvar a anotação da aula.");
    },
  });

  const questionNotes: QuestionUserNote[] = useMemo(
    () => questionNotesData?.notes ?? [],
    [questionNotesData]
  );
  const lessonNotes: LessonUserNote[] = useMemo(
    () => (canAccessLessons ? lessonNotesData?.notes ?? [] : []),
    [canAccessLessons, lessonNotesData]
  );

  const visibleItems = useMemo<UnifiedNoteItem[]>(() => {
    const items: UnifiedNoteItem[] = [];
    if (effectiveTab === "all" || effectiveTab === "lessons") {
      for (const ln of lessonNotes) {
        items.push({ kind: "lesson", updatedAt: ln.updated_at || "", data: ln });
      }
    }
    if (effectiveTab === "all" || effectiveTab === "questions") {
      for (const qn of questionNotes) {
        items.push({ kind: "question", updatedAt: qn.updated_at || "", data: qn });
      }
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
  }, [effectiveTab, lessonNotes, questionNotes]);

  const isLoading =
    (effectiveTab !== "lessons" && loadingQuestionNotes) ||
    (canAccessLessons && effectiveTab !== "questions" && loadingLessonNotes);
  const isError =
    (effectiveTab === "questions" && isQuestionNotesError) ||
    (effectiveTab === "lessons" && isLessonNotesError) ||
    (effectiveTab === "all" && isQuestionNotesError && (!canAccessLessons || isLessonNotesError));

  return (
    <div className="flex flex-col gap-5 w-full max-w-5xl mx-auto">
      <header className="mq-page-hero p-5 sm:p-6 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="inline-block text-xs font-semibold text-accent">
            Retenção Ativa &amp; Macetes
          </span>
          <h1 className="text-2xl font-bold text-ink-primary tracking-tight flex items-center gap-2 mt-0.5">
            <StickyNote className="w-6 h-6 text-accent" />
            Caderno Inteligente
          </h1>
          <p className="text-sm text-ink-secondary mt-1">
            {canAccessLessons
              ? "Todas as suas anotações de aulas, grifos de enunciado e macetes clínicos organizados por área e tema."
              : "Todos os grifos de enunciado e macetes clínicos anotados durante suas sessões, organizados por área e tema."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canAccessLessons && (
            <Link
              href="/aulas"
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-surface border border-line-subtle text-ink-primary text-xs font-semibold hover:bg-elevated transition-colors shadow-2xs"
            >
              <PlayCircle className="w-3.5 h-3.5 text-accent" />
              Aulas
            </Link>
          )}
          <Link
            href="/estudar"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors shadow-2xs"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Estudar Questões
          </Link>
        </div>
      </header>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label={
              canAccessLessons
                ? "Buscar em anotações de aulas, macetes, grifos ou subtemas"
                : "Buscar em macetes, grifos ou subtemas"
            }
            placeholder={
              canAccessLessons
                ? "Buscar em anotações de aulas, macetes, grifos ou subtemas..."
                : "Buscar em macetes, grifos ou subtemas..."
            }
            className="w-full pl-10 pr-3 py-2.5 text-xs bg-surface border border-line-subtle rounded-xl text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent shadow-2xs"
          />
        </div>
        <select
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          aria-label="Filtrar por grande área"
          className="px-3.5 py-2.5 text-xs bg-surface border border-line-subtle rounded-xl text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent shadow-2xs"
        >
          <option value="">Todas as Grandes Áreas</option>
          {areaOptions.map((area) => (
            <option key={area} value={area}>
              {area}
            </option>
          ))}
        </select>
      </div>

      {canAccessLessons && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center rounded-md bg-surface border border-line-subtle p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className={clsx(
                "px-3 py-1.5 rounded-xs font-semibold transition-colors cursor-pointer",
                effectiveTab === "all"
                  ? "bg-accent text-white shadow-2xs"
                  : "text-ink-secondary hover:text-ink-primary"
              )}
            >
              Tudo ({lessonNotes.length + questionNotes.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("lessons")}
              className={clsx(
                "px-3 py-1.5 rounded-xs font-semibold transition-colors cursor-pointer",
                effectiveTab === "lessons"
                  ? "bg-accent text-white shadow-2xs"
                  : "text-ink-secondary hover:text-ink-primary"
              )}
            >
              Aulas ({lessonNotes.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("questions")}
              className={clsx(
                "px-3 py-1.5 rounded-xs font-semibold transition-colors cursor-pointer",
                effectiveTab === "questions"
                  ? "bg-accent text-white shadow-2xs"
                  : "text-ink-secondary hover:text-ink-primary"
              )}
            >
              Questões ({questionNotes.length})
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-xs text-ink-secondary">
          Carregando suas anotações...
        </div>
      ) : isError ? (
        <div className="p-4 rounded-xs border border-destructive/30 bg-destructive/5 text-xs text-destructive">
          Erro ao carregar o Caderno Inteligente. Verifique sua conexão e tente novamente.
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-surface border border-line-subtle rounded-sm gap-2">
          <StickyNote className="w-8 h-8 text-ink-muted opacity-60" />
          <h2 className="text-sm font-semibold text-ink-primary">Nenhuma anotação encontrada</h2>
          <p className="text-xs text-ink-secondary max-w-md">
            {effectiveTab === "lessons"
              ? "As anotações salvas abaixo do player de vídeo em Aulas aparecem automaticamente aqui."
              : canAccessLessons
              ? "Salve anotações nas aulas em vídeo ou faça grifos e macetes nas questões do módulo Estudar para vê-los organizados aqui."
              : "Durante a resolução de questões no módulo Estudar, selecione trechos para grifar ou salve um macete clínico na própria questão."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {visibleItems.map((item) => {
            if (item.kind === "lesson") {
              const note = item.data;
              const isEditing = editingLessonId === note.lesson_id;
              const bookmarkLabel = formatBookmark(note.bookmark_seconds);
              const dateLabel = formatUpdatedDate(note.updated_at);
              const lessonHref = buildLessonReturnUrl({
                lessonId: note.lesson_id,
                subtema: note.subtema,
              });

              return (
                <article
                  key={`lesson-${note.lesson_id}`}
                  className="bg-surface border border-line-subtle rounded-sm p-4 flex flex-col gap-3 shadow-2xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs bg-primary/10 text-primary border border-primary/25 font-semibold">
                        <PlayCircle className="w-3 h-3" />
                        Aula
                      </span>
                      {note.area && (
                        <span className="px-2 py-0.5 rounded-xs bg-elevated text-ink-secondary">
                          {note.area}
                        </span>
                      )}
                      {note.subtema && (
                        <span className="px-2 py-0.5 rounded-xs bg-elevated/80 text-ink-muted">
                          {note.subtema}
                        </span>
                      )}
                      {bookmarkLabel && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs bg-warning/10 text-warning border border-warning/25 font-mono-lab font-semibold">
                          <Clock className="w-3 h-3" />
                          {bookmarkLabel}
                        </span>
                      )}
                      {dateLabel && (
                        <span className="text-[10px] font-mono-lab text-ink-muted">
                          • {dateLabel}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Link
                        href={lessonHref}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                      >
                        Abrir aula <ArrowUpRight className="w-3 h-3" />
                      </Link>
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLessonId(note.lesson_id);
                            setEditingDraft(note.notes);
                          }}
                          className="p-1.5 min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xs text-ink-muted hover:text-ink-primary hover:bg-elevated transition-colors cursor-pointer"
                          title="Editar anotação da aula"
                          aria-label={`Editar anotação da aula ${note.title}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={updateLessonNoteMutation.isPending}
                        onClick={() =>
                          updateLessonNoteMutation.mutate({ lessonId: note.lesson_id, notes: "" })
                        }
                        className="p-1.5 min-w-[34px] min-h-[34px] flex items-center justify-center rounded-xs text-ink-muted hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                        title="Excluir anotação da aula"
                        aria-label={`Excluir anotação da aula ${note.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <h2 className="text-xs font-bold text-ink-primary leading-snug">
                      {note.title}
                    </h2>
                    <span className="text-[11px] text-ink-muted">
                      {note.course_name} • {note.module_name}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={editingDraft}
                        onChange={(e) => setEditingDraft(e.target.value)}
                        rows={4}
                        className="w-full px-3 py-2 rounded-md border border-accent/50 bg-canvas text-xs text-ink-primary focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLessonId(null);
                            setEditingDraft("");
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xs border border-line-subtle bg-canvas text-xs text-ink-secondary hover:text-ink-primary cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={updateLessonNoteMutation.isPending}
                          onClick={() =>
                            updateLessonNoteMutation.mutate({
                              lessonId: note.lesson_id,
                              notes: editingDraft.trim(),
                            })
                          }
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-xs bg-accent text-white text-xs font-semibold hover:bg-accent/90 cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          Salvar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-elevated/60 border-l-2 border-primary px-3 py-2.5 rounded-r-xs text-xs text-ink-primary whitespace-pre-wrap leading-relaxed">
                      {note.notes}
                    </div>
                  )}
                </article>
              );
            }

            const note = item.data;
            return (
              <article
                key={`question-${note.question_id}`}
                className="bg-surface border border-line-subtle rounded-sm p-4 flex flex-col gap-3 shadow-2xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="px-2 py-0.5 rounded-xs bg-elevated border border-line-subtle font-mono-lab font-semibold text-ink-primary">
                      Q#{note.question_id}
                    </span>
                    {note.institution_code && (
                      <span className="px-2 py-0.5 rounded-xs bg-accent/10 text-accent font-medium">
                        {note.institution_code} {note.year ? `• ${note.year}` : ""}
                      </span>
                    )}
                    {note.area && (
                      <span className="px-2 py-0.5 rounded-xs bg-elevated text-ink-secondary">
                        {note.area}
                      </span>
                    )}
                    {note.subtema && (
                      <span className="px-2 py-0.5 rounded-xs bg-elevated/80 text-ink-muted">
                        {note.subtema}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/estudar?id=${note.question_id}`}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                    >
                      Abrir questão <ArrowUpRight className="w-3 h-3" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => deleteQuestionNoteMutation.mutate(note.question_id)}
                      className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xs text-ink-muted hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                      title="Excluir anotação"
                      aria-label={`Excluir anotação da questão ${note.question_id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {note.note_text && (
                  <div className="bg-elevated/60 border-l-2 border-accent px-3 py-2 rounded-r-xs text-xs text-ink-primary whitespace-pre-wrap leading-relaxed">
                    {note.note_text}
                  </div>
                )}

                {note.highlights && note.highlights.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-mono-lab uppercase tracking-wider text-ink-muted flex items-center gap-1">
                      <Highlighter className="w-3 h-3" /> Trechos grifados ({note.highlights.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {note.highlights.map((hl) => (
                        <span
                          key={hl.id}
                          className="px-2 py-0.5 rounded-xs text-[11px] bg-warning/15 text-ink-primary border border-warning/30"
                        >
                          “{hl.text}”
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {note.stem_preview && (
                  <p className="text-[11px] text-ink-muted line-clamp-2 border-t border-line-subtle/60 pt-2">
                    {note.stem_preview}...
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

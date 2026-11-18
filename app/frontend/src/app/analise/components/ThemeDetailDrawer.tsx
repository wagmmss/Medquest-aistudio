"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock,
  Flame,
  RotateCcw,
  Target,
  X,
  Zap,
} from "lucide-react";
import type {
  CoverageSubtema,
  LearningProfileTopic,
  ThemeProgress,
} from "@/types/api";
import { api } from "@/lib/api";
import { plannerData } from "@/lib/plannerData";
import { getThemeUrls } from "@/lib/themeJourney";

interface ThemeDetailDrawerProps {
  subtema: string | null;
  coverageSubtema?: CoverageSubtema | null;
  topic?: LearningProfileTopic | null;
  onClose: () => void;
}

export function ThemeDetailDrawer({
  subtema,
  coverageSubtema,
  topic,
  onClose,
}: ThemeDetailDrawerProps) {
  const queryClient = useQueryClient();
  const [manualPracticeLimit, setManualPracticeLimit] = useState<{
    subtema: string;
    limit: 10 | 20 | 30;
  } | null>(null);
  const [savingProgress, setSavingProgress] = useState(false);

  const { data: queriedProgress } = useQuery({
    queryKey: ["theme-progress", subtema],
    queryFn: () => api.themes.getProgress(subtema!),
    enabled: Boolean(subtema),
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (!subtema) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [subtema, onClose]);

  if (!subtema) return null;

  const activeProgress: ThemeProgress | null =
    queriedProgress?.subtema === subtema ? queriedProgress : null;
  const practiceLimit: 10 | 20 | 30 =
    manualPracticeLimit?.subtema === subtema
      ? manualPracticeLimit.limit
      : activeProgress?.study_path === "essential"
      ? 10
      : 20;
  const setPracticeLimit = (limit: 10 | 20 | 30) =>
    setManualPracticeLimit({ subtema, limit });

  const group = plannerData.find((area) =>
    area.macroThemes.some((theme) => theme.dbSubtemas.includes(subtema))
  );
  const themeMeta = group?.macroThemes.find((item) =>
    item.dbSubtemas.includes(subtema)
  );

  const areaLabel = coverageSubtema?.area || group?.area || topic?.area || "Tema";
  const isHighYield = Boolean(coverageSubtema?.highYield ?? themeMeta?.highYield);
  const details = themeMeta?.details ?? [];

  const available = topic?.available ?? coverageSubtema?.n_questions ?? 0;
  const answered = topic?.answered ?? coverageSubtema?.answered ?? 0;
  const attempts = topic?.attempts ?? coverageSubtema?.attempts ?? 0;
  const correct = topic?.correct ?? coverageSubtema?.correct ?? 0;
  const accuracy = topic?.accuracy ?? coverageSubtema?.accuracy ?? null;
  const retrievability = topic?.retrievability ?? null;
  const dueCount = topic?.due_count ?? 0;

  const coveragePct =
    available > 0 ? Math.min(100, Math.round((answered / available) * 100)) : 0;
  const urls = getThemeUrls(subtema);

  const handleSaveProgress = async (
    nextCompleted: boolean,
    nextPath: "essential" | "complete"
  ) => {
    setSavingProgress(true);
    const optimistic: ThemeProgress = {
      subtema,
      theory_completed: nextCompleted,
      study_path: nextPath,
      updated_at: new Date().toISOString(),
    };
    queryClient.setQueryData(["theme-progress", subtema], optimistic);
    try {
      const saved = await api.themes.saveProgress(subtema, {
        theory_completed: nextCompleted,
        study_path: nextPath,
      });
      queryClient.setQueryData(["theme-progress", subtema], saved);
    } catch {
      // Keep UI responsive even if offline/save fails
    } finally {
      setSavingProgress(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-drawer-title"
    >
      <div
        className="w-full max-w-2xl bg-surface border-l border-line-subtle h-full overflow-y-auto p-4 sm:p-6 md:p-7 flex flex-col gap-5 sm:gap-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 sm:gap-4 border-b border-line-subtle pb-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-xs bg-elevated text-ink-secondary border border-line-subtle">
                {areaLabel}
              </span>
              {isHighYield && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-xs bg-warning/10 text-warning border border-warning/25">
                  <Flame size={12} /> Alta incidência USP
                </span>
              )}
            </div>
            <h2
              id="theme-drawer-title"
              className="text-lg sm:text-xl font-bold text-ink-primary tracking-tight break-words"
            >
              {subtema}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {available > 0 && (
              <Link
                href={urls.practice(10)}
                className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-2 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors"
              >
                <Zap size={13} />
                Treinar (10q)
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar detalhes do tema"
              className="min-w-[38px] min-h-[38px] flex items-center justify-center p-2 rounded-md border border-line-subtle bg-canvas text-ink-secondary hover:text-ink-primary transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Edital Details */}
        {details.length > 0 && (
          <div className="rounded-md border border-line-subtle bg-canvas p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
              Pontos-chave do edital
            </p>
            <ul className="flex flex-wrap gap-1.5 text-xs">
              {details.map((detail) => (
                <li
                  key={detail}
                  className="px-2 py-1 rounded-xs bg-surface text-ink-primary border border-line-subtle"
                >
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 4 KPIs */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-line-subtle bg-canvas p-3.5 sm:p-4">
            <div className="flex items-center justify-between text-ink-secondary mb-1.5">
              <span className="text-xs font-medium">Cobertura</span>
              <Target size={15} />
            </div>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-xl sm:text-2xl font-mono-lab tabular-nums font-bold text-ink-primary">
                {answered}
              </span>
              <span className="text-xs font-mono-lab text-ink-muted">/ {available} q</span>
              <span className="ml-auto text-xs font-mono-lab font-semibold px-1.5 py-0.5 rounded-xs bg-primary/10 text-primary">
                {coveragePct}%
              </span>
            </div>
            <div className="w-full bg-elevated rounded-xs h-1.5 mt-2.5 overflow-hidden">
              <div className="bg-primary h-full" style={{ width: `${coveragePct}%` }} />
            </div>
            <p className="text-[11px] text-ink-muted mt-2 font-mono-lab tabular-nums">
              {attempts} {attempts === 1 ? "tentativa total" : "tentativas no total"}
            </p>
          </div>

          <div className="rounded-md border border-line-subtle bg-canvas p-3.5 sm:p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-ink-secondary mb-1.5">
                <span className="text-xs font-medium">Acurácia Geral</span>
                <Zap size={15} />
              </div>
              <p className="text-xl sm:text-2xl font-mono-lab tabular-nums font-bold text-ink-primary">
                {accuracy != null ? `${Math.round(accuracy * 100)}%` : "—"}
              </p>
            </div>
            <p className="text-[11px] text-ink-muted mt-2 font-mono-lab tabular-nums">
              {attempts > 0 ? `${correct} acertos em ${attempts} tent.` : "Sem respostas"}
            </p>
          </div>

          <div className="rounded-md border border-line-subtle bg-canvas p-3.5 sm:p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-ink-secondary mb-1.5">
                <span className="text-xs font-medium">Retenção FSRS</span>
                <Brain size={15} />
              </div>
              <p className="text-xl sm:text-2xl font-mono-lab tabular-nums font-bold text-ink-primary">
                {retrievability != null ? `${Math.round(retrievability * 100)}%` : "—"}
              </p>
            </div>
            <p className="text-[11px] text-ink-muted mt-2">
              {retrievability != null ? "Recordação estimada" : "Estimada após revisões"}
            </p>
          </div>

          <div
            className={clsx(
              "rounded-md border p-3.5 sm:p-4 flex flex-col justify-between",
              dueCount > 0
                ? "border-warning/40 bg-warning/5"
                : "border-line-subtle bg-canvas"
            )}
          >
            <div>
              <div className="flex items-center justify-between text-ink-secondary mb-1.5">
                <span className="text-xs font-medium">FSRS Vencidas</span>
                <Clock size={15} className={dueCount > 0 ? "text-warning" : undefined} />
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className={clsx(
                    "text-xl sm:text-2xl font-mono-lab tabular-nums font-bold",
                    dueCount > 0 ? "text-warning" : "text-ink-primary"
                  )}
                >
                  {dueCount}
                </span>
                <span
                  className={clsx(
                    "text-xs font-semibold",
                    dueCount > 0 ? "text-warning" : "text-success"
                  )}
                >
                  {dueCount > 0 ? "urgentes" : "em dia"}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-ink-muted mt-2">
              {dueCount > 0 ? "Aguardando repetição espaçada" : "Nenhuma questão vencida"}
            </p>
          </div>
        </div>

        {/* Theory Progress Controls */}
        <div className="rounded-md border border-line-subtle bg-canvas p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink-primary">Progresso Teórico & Trilha</h3>
              <p className="text-xs text-ink-secondary">
                Marque a leitura teórica e ajuste o ritmo de prática recomendado.
              </p>
            </div>
            <button
              type="button"
              disabled={savingProgress}
              aria-pressed={Boolean(activeProgress?.theory_completed)}
              onClick={() =>
                handleSaveProgress(
                  !(activeProgress?.theory_completed ?? false),
                  activeProgress?.study_path ?? "complete"
                )
              }
              className={clsx(
                "inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer shrink-0",
                activeProgress?.theory_completed
                  ? "bg-success/10 text-success border-success/30"
                  : "bg-surface text-ink-primary border-line-subtle hover:bg-elevated"
              )}
            >
              <CheckCircle2 size={14} />
              {activeProgress?.theory_completed ? "Teoria concluída" : "Marcar teoria"}
            </button>
          </div>

          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <span className="text-xs text-ink-secondary">Trilha:</span>
            {(["essential", "complete"] as const).map((path) => {
              const active = (activeProgress?.study_path ?? "complete") === path;
              return (
                <button
                  key={path}
                  type="button"
                  disabled={savingProgress}
                  aria-pressed={active}
                  onClick={() =>
                    handleSaveProgress(activeProgress?.theory_completed ?? false, path)
                  }
                  className={clsx(
                    "min-h-[36px] px-3 py-1 rounded-xs text-xs font-semibold border cursor-pointer transition-colors",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-surface text-ink-secondary border-line-subtle hover:text-ink-primary"
                  )}
                >
                  {path === "essential" ? "Essencial (10q)" : "Completa (20q)"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Study Actions */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-md border border-line-subtle bg-canvas p-4 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <RotateCcw size={17} className={dueCount > 0 ? "text-warning" : "text-ink-muted"} />
                <span className="text-xs font-mono-lab text-ink-muted">
                  {dueCount} pendentes
                </span>
              </div>
              <h3 className="text-sm font-bold text-ink-primary">Revisar Vencidas (FSRS)</h3>
              <p className="text-xs text-ink-secondary mt-1">
                Repita questões no intervalo calculado pelo algoritmo para consolidar retenção.
              </p>
            </div>
            {dueCount > 0 ? (
              <Link
                href={urls.review}
                className="w-full inline-flex items-center justify-center gap-2 min-h-[38px] py-2 px-3 rounded-md bg-warning text-white font-semibold text-xs hover:opacity-90 transition-opacity"
              >
                Revisar Agora ({dueCount}) <ArrowRight size={14} />
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="w-full inline-flex items-center justify-center gap-1.5 min-h-[38px] py-2 px-3 rounded-md bg-elevated text-ink-muted font-medium text-xs cursor-not-allowed"
              >
                <CheckCircle2 size={14} className="text-success" />
                Nenhuma revisão pendente
              </button>
            )}
          </div>

          <div className="rounded-md border border-primary/30 bg-canvas p-4 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <Zap size={17} className="text-primary" />
                <span className="text-[11px] font-semibold text-primary">Recomendado</span>
              </div>
              <h3 className="text-sm font-bold text-ink-primary">Praticar Adaptativo</h3>
              <div className="grid grid-cols-3 gap-1.5 mt-3">
                {([10, 20, 30] as const).map((count) => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={practiceLimit === count}
                    onClick={() => setPracticeLimit(count)}
                    className={clsx(
                      "min-h-[36px] py-1 px-2 rounded-xs text-xs font-mono-lab font-semibold border cursor-pointer transition-colors",
                      practiceLimit === count
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-surface text-ink-secondary border-line-subtle hover:text-ink-primary"
                    )}
                  >
                    {count}q
                  </button>
                ))}
              </div>
            </div>

            {available > 0 ? (
              <Link
                href={urls.practice(practiceLimit)}
                className="w-full inline-flex items-center justify-center gap-2 min-h-[38px] py-2 px-3 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs transition-colors"
              >
                Treinar ({practiceLimit}q) <ArrowRight size={14} />
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="w-full inline-flex items-center justify-center min-h-[38px] py-2 px-3 rounded-md bg-elevated text-ink-muted text-xs cursor-not-allowed"
              >
                Sem questões disponíveis
              </button>
            )}
          </div>
        </div>

        <div className="pt-2 border-t border-line-subtle flex items-center justify-between text-xs text-ink-secondary">
          <Link href="/planner" className="hover:text-primary transition-colors">
            Abrir Planner semanal →
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-primary font-semibold hover:underline cursor-pointer min-h-[36px] px-2"
          >
            Fechar painel
          </button>
        </div>
      </div>
    </div>
  );
}

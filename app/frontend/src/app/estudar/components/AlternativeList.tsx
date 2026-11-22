"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Scissors, Eye, EyeOff, BarChart2 } from "lucide-react";
import clsx from "clsx";
import { AttemptResult } from "@/types/api";
import { AlternativeContent, getAlternativePlainText } from "@/components/AlternativeContent";

export interface AlternativeItem {
  letter: string;
  text: string;
  is_correct?: boolean;
  pct?: number;
}

export interface AlternativeListProps {
  alternatives: AlternativeItem[];
  selectedLetter: string | null;
  attemptResult: AttemptResult | null;
  eliminatedLetters: string[];
  submitting: boolean;
  onSelectAlternative: (letter: string) => void;
  onToggleEliminate: (letter: string) => void;
  onImageClick?: (url: string) => void;
  questionId?: number;
  alreadyAnsweredLetter?: string | null;
}

const HIDE_STATS_STORAGE_KEY = "medquest:hide-alt-stats";

export const AlternativeList: React.FC<AlternativeListProps> = React.memo(({
  alternatives,
  selectedLetter,
  attemptResult,
  eliminatedLetters,
  submitting,
  onSelectAlternative,
  onToggleEliminate,
  onImageClick,
  alreadyAnsweredLetter,
}) => {
  const [hideStats, setHideStats] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(HIDE_STATS_STORAGE_KEY) === "1";
  });

  const toggleHideStats = () => {
    setHideStats((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(HIDE_STATS_STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2.5" role="region" aria-label="Alternativas da questão">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[11px] font-mono-lab uppercase tracking-wider text-ink-muted font-semibold flex items-center gap-1.5">
          <BarChart2 size={12} className="text-accent" />
          Alternativas ({alternatives.length})
        </span>
        <button
          type="button"
          onClick={toggleHideStats}
          aria-pressed={hideStats}
          title={
            hideStats
              ? "Mostrar estatísticas das alternativas e histórico prévio"
              : "Ocultar estatísticas das alternativas e histórico prévio para evitar viés na revisão"
          }
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-xs border border-line-subtle bg-surface hover:bg-elevated text-[11px] font-mono-lab text-ink-secondary hover:text-ink-primary transition-colors cursor-pointer"
        >
          {hideStats ? <EyeOff size={12} className="text-warning" /> : <Eye size={12} className="text-accent" />}
          <span>{hideStats ? "Estatísticas ocultas" : "Ocultar estatísticas"}</span>
        </button>
      </div>

      {alternatives.map((alt) => {
        const isSelected = selectedLetter === alt.letter;
        const isCorrect =
          attemptResult?.correct_letter === alt.letter ||
          (attemptResult && isSelected && attemptResult.is_correct);
        const isWrong = attemptResult && isSelected && !attemptResult.is_correct;
        const isEliminated = eliminatedLetters.includes(alt.letter);

        const rawStatPct =
          attemptResult?.alt_stats?.[alt.letter] ??
          (typeof alt.pct === "number" ? alt.pct : undefined);
        const statPct =
          typeof rawStatPct === "number"
            ? Math.max(0, Math.min(100, Math.round(rawStatPct)))
            : null;
        const showStatBar = Boolean(attemptResult && !hideStats && statPct !== null);
        const showPreviousAttemptTag = Boolean(
          !hideStats && !attemptResult && alreadyAnsweredLetter && alreadyAnsweredLetter === alt.letter
        );

        let altClass =
          "bg-surface border-line-subtle hover:bg-elevated/50 hover:border-line-strong cursor-pointer shadow-xs";
        if (isSelected && !attemptResult) {
          altClass = "bg-accent/10 border-accent text-ink cursor-pointer shadow-xs ring-1 ring-accent/30";
        }
        if (isEliminated && !attemptResult && !isSelected) {
          altClass = "bg-canvas/40 border-line-subtle/50 opacity-50 hover:opacity-80 cursor-pointer shadow-none";
        }
        if (attemptResult) {
          if (isCorrect) {
            altClass = "bg-normal/10 border-normal/50 text-ink shadow-xs cursor-default ring-1 ring-normal/30";
          } else if (isWrong) {
            altClass = "bg-critical/10 border-critical/50 text-ink shadow-xs cursor-default ring-1 ring-critical/30";
          } else {
            altClass = "bg-surface border-line-subtle opacity-55 cursor-default";
          }
        }

        const altAriaStatus = [
          isEliminated ? "riscada" : "",
          isSelected ? "selecionada" : "",
          attemptResult && isCorrect ? "gabarito correto" : "",
          attemptResult && isWrong ? "resposta incorreta" : "",
        ].filter(Boolean).join(", ");

        const plainText = getAlternativePlainText(alt.text);
        const altAriaLabel = `Alternativa ${alt.letter}: ${plainText}${altAriaStatus ? ` (${altAriaStatus})` : ""}`;

        return (
          <motion.div
            role="button"
            tabIndex={attemptResult || submitting ? -1 : 0}
            whileTap={!attemptResult && !submitting ? { scale: 0.995 } : {}}
            animate={
              attemptResult && isWrong
                ? { x: [-3, 3, -3, 3, 0], transition: { duration: 0.3 } }
                : attemptResult && isCorrect
                ? { scale: [1, 1.01, 1], transition: { duration: 0.3 } }
                : {}
            }
            key={alt.letter}
            onClick={() => onSelectAlternative(alt.letter)}
            onKeyDown={(e) => {
              if (attemptResult || submitting) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                // Já selecionada: deixa o atalho global confirmar esta mesma letra.
                if (isSelected) return;
                // Ainda não selecionada: só seleciona. Sem stopPropagation o atalho
                // global (window) confirmaria a letra antiga, pois o React ainda
                // não re-renderizou com a nova seleção neste mesmo evento.
                e.stopPropagation();
                onSelectAlternative(alt.letter);
              }
            }}
            onContextMenu={(e) => {
              if (!attemptResult && !submitting) {
                e.preventDefault();
                onToggleEliminate(alt.letter);
              }
            }}
            className={clsx(
              "group relative text-left p-3 sm:p-3.5 rounded-sm border transition-all flex items-start gap-2.5 sm:gap-3 w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent select-none overflow-hidden",
              altClass
            )}
            aria-label={altAriaLabel}
            aria-pressed={isSelected}
            aria-disabled={!!attemptResult || submitting}
          >
            {/* Botão de Risco / Tesoura */}
            {!attemptResult ? (
              <button
                type="button"
                title={
                  isEliminated
                    ? `Restaurar alternativa ${alt.letter}`
                    : `Riscar alternativa ${alt.letter} (Shift+${alt.letter} ou botão direito)`
                }
                aria-label={
                  isEliminated
                    ? `Restaurar alternativa ${alt.letter}`
                    : `Riscar alternativa ${alt.letter}`
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleEliminate(alt.letter);
                }}
                disabled={submitting}
                className={clsx(
                  "w-6 h-7 shrink-0 flex items-center justify-center rounded-xs transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                  isEliminated
                    ? "opacity-100 text-critical hover:scale-105"
                    : "opacity-0 group-hover:opacity-70 hover:opacity-100 hover:text-accent max-md:opacity-40 text-ink-muted"
                )}
              >
                <Scissors
                  size={14}
                  aria-hidden="true"
                  className={clsx("transition-transform duration-150", isEliminated && "rotate-45")}
                />
              </button>
            ) : (
              <div className="w-6 h-7 shrink-0 flex items-center justify-center text-ink-muted/30" aria-hidden="true">
                {isEliminated && !isCorrect && (
                  <Scissors size={12} aria-hidden="true" className="opacity-40 rotate-45 text-critical" />
                )}
              </div>
            )}

            {/* Badge da Letra */}
            <div
              aria-hidden="true"
              className={clsx(
                "w-7 h-7 shrink-0 flex items-center justify-center rounded-xs font-mono-lab font-bold text-xs transition-colors border",
                isSelected && !attemptResult
                  ? "bg-accent text-white border-accent"
                  : isCorrect
                  ? "bg-normal text-white border-normal"
                  : isWrong
                  ? "bg-critical text-white border-critical"
                  : isEliminated && !attemptResult
                  ? "bg-canvas text-ink-muted/50 border-line-subtle/50"
                  : "bg-canvas text-ink-muted border-line-subtle"
              )}
            >
              {submitting && isSelected ? (
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                alt.letter
              )}
            </div>

            {/* Texto da Alternativa + Barra de Estatística */}
            <div
              aria-hidden="true"
              className={clsx(
                "pt-0.5 text-ink leading-relaxed flex-1 text-sm md:text-base transition-all min-w-0",
                isEliminated && !isCorrect && "line-through text-ink-muted/70 decoration-ink-muted/50"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <AlternativeContent
                    content={alt.text}
                    isEliminated={isEliminated && !isCorrect}
                    onImageClick={onImageClick}
                  />
                </div>
                {showPreviousAttemptTag && (
                  <span className="shrink-0 text-[10px] font-mono-lab px-1.5 py-0.5 rounded-xs bg-elevated border border-line-subtle text-ink-muted">
                    Marcada antes
                  </span>
                )}
                {showStatBar && (
                  <span
                    className={clsx(
                      "shrink-0 text-[11px] font-mono-lab tabular-nums font-bold px-1.5 py-0.5 rounded-xs border",
                      isCorrect
                        ? "bg-normal/15 text-normal border-normal/30"
                        : isWrong
                        ? "bg-critical/15 text-critical border-critical/30"
                        : "bg-canvas text-ink-muted border-line-subtle"
                    )}
                    title="Proporção de escolha pelos médicos residentes nesta alternativa"
                  >
                    {statPct}%
                  </span>
                )}
              </div>

              {showStatBar && (
                <div className="mt-2 h-1 w-full bg-canvas/80 rounded-full overflow-hidden">
                  <div
                    className={clsx(
                      "h-full transition-all duration-300 rounded-full",
                      isCorrect ? "bg-normal" : isWrong ? "bg-critical" : "bg-ink-muted/40"
                    )}
                    style={{ width: `${statPct}%` }}
                  />
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
});

AlternativeList.displayName = "AlternativeList";


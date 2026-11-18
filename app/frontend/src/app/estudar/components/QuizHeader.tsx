"use client";

import React, { useState, useRef, useEffect } from "react";
import clsx from "clsx";
import { FlaskConical, Keyboard } from "lucide-react";
import { QuizTimer, QuizTimerHandle } from "@/components/QuizTimer";
import { ClinicalIcon } from "@/components/ui/ClinicalIcon";

export type StemFontSize = "sm" | "md" | "lg";

export interface QuizHeaderProps {
  onBackToFilters: () => void;
  completedCount: number;
  totalCount: number;
  onRequestFinish: () => void;
  zenMode: boolean;
  onToggleZenMode: () => void;
  quizTimerRef: React.RefObject<QuizTimerHandle | null>;
  isTimerRunning: boolean;
  initialTime: number;
  hasQuestion: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onOpenLabs?: () => void;
  stemFontSize?: StemFontSize;
  onCycleFontSize?: () => void;
}

export const QuizHeader: React.FC<QuizHeaderProps> = React.memo(({
  onBackToFilters,
  completedCount,
  totalCount,
  onRequestFinish,
  zenMode,
  onToggleZenMode,
  quizTimerRef,
  isTimerRunning,
  initialTime,
  hasQuestion,
  isFavorite = false,
  onToggleFavorite,
  onOpenLabs,
  stemFontSize = "md",
  onCycleFontSize,
}) => {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shortcutsOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShortcutsOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShortcutsOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [shortcutsOpen]);

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 bg-surface/90 backdrop-blur-md border border-line-subtle rounded-md px-3 sm:px-4 py-2 sm:py-2.5 shadow-2xs relative z-20">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onBackToFilters}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted hover:text-ink-primary transition-colors cursor-pointer min-h-[38px] px-2.5 -ml-1 rounded-xs hover:bg-elevated/60 border border-transparent hover:border-line-subtle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <ClinicalIcon name="arrowLeft" size={14} />
          <span>Filtros</span>
        </button>
        <div className="h-4 w-px bg-line-subtle hidden sm:block" />
        <div className="text-xs font-semibold text-ink-primary flex items-center gap-2" aria-live="polite">
          <span className="text-ink-muted uppercase text-[10px] tracking-wider hidden sm:inline">Progresso:</span>
          <span className="font-mono-lab tabular-nums bg-canvas px-2 py-0.5 rounded-xs border border-line-subtle text-accent font-bold">
            {completedCount} / {totalCount}
          </span>
        </div>

        <div className="relative hidden md:block" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setShortcutsOpen((prev) => !prev)}
            aria-expanded={shortcutsOpen}
            aria-haspopup="dialog"
            aria-label="Ver atalhos de teclado"
            className={clsx(
              "flex items-center gap-1.5 min-h-[38px] px-2.5 py-1 rounded-xs border text-[11px] font-mono-lab transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
              shortcutsOpen
                ? "bg-accent/10 border-accent/30 text-accent"
                : "bg-canvas/70 border-line-subtle text-ink-muted hover:text-ink-primary hover:bg-elevated"
            )}
          >
            <Keyboard size={13} />
            <span>Atalhos</span>
          </button>

          {shortcutsOpen && (
            <div
              role="dialog"
              aria-label="Atalhos de teclado do estudo"
              className="absolute left-0 top-full mt-1.5 w-64 rounded-md border border-line-subtle bg-surface shadow-xl p-3 z-30 flex flex-col gap-2 text-xs font-mono-lab"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted border-b border-line-subtle pb-1.5">
                Atalhos do Estudo
              </p>
              <div className="flex items-center justify-between text-ink-secondary">
                <span>Selecionar alternativa</span>
                <kbd className="bg-canvas border border-line-subtle px-1.5 py-0.5 rounded-xs text-[10px] text-ink-primary">A-E</kbd>
              </div>
              <div className="flex items-center justify-between text-ink-secondary">
                <span>Riscar alternativa</span>
                <kbd className="bg-canvas border border-line-subtle px-1.5 py-0.5 rounded-xs text-[10px] text-ink-primary">Shift+A-E</kbd>
              </div>
              <div className="flex items-center justify-between text-ink-secondary">
                <span>Confirmar / Avançar</span>
                <kbd className="bg-canvas border border-line-subtle px-1.5 py-0.5 rounded-xs text-[10px] text-ink-primary">Enter</kbd>
              </div>
              <div className="flex items-center justify-between text-ink-secondary">
                <span>Navegar questões</span>
                <kbd className="bg-canvas border border-line-subtle px-1.5 py-0.5 rounded-xs text-[10px] text-ink-primary">← / →</kbd>
              </div>
              <div className="flex items-center justify-between text-ink-secondary">
                <span>Modo Zen</span>
                <kbd className="bg-canvas border border-line-subtle px-1.5 py-0.5 rounded-xs text-[10px] text-ink-primary">Z</kbd>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
        {onOpenLabs && (
          <button
            type="button"
            onClick={onOpenLabs}
            className="flex items-center justify-center gap-1.5 min-h-[38px] min-w-[38px] px-2.5 py-1.5 bg-surface hover:bg-elevated text-ink-secondary hover:text-accent rounded-xs transition-colors border border-line-subtle text-xs font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            title="Valores de Referência Laboratoriais"
            aria-label="Abrir valores de referência laboratoriais"
          >
            <FlaskConical size={13} />
            <span className="hidden md:inline">Labs</span>
          </button>
        )}

        {onCycleFontSize && (
          <button
            type="button"
            onClick={onCycleFontSize}
            className="flex items-center justify-center min-h-[38px] min-w-[38px] px-2 py-1.5 bg-surface hover:bg-elevated text-ink-muted hover:text-ink-primary rounded-xs transition-colors border border-line-subtle text-xs font-mono-lab font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            title={`Tamanho do texto: ${stemFontSize === "sm" ? "Compacto" : stemFontSize === "lg" ? "Ampliado" : "Padrão"} (clique para alternar)`}
            aria-label="Alternar tamanho da fonte do enunciado"
          >
            Aa{stemFontSize === "sm" ? "−" : stemFontSize === "lg" ? "+" : ""}
          </button>
        )}

        <button
          type="button"
          onClick={onRequestFinish}
          className="flex items-center gap-1.5 min-h-[38px] px-2.5 sm:px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-xs transition-colors text-xs font-bold cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          title="Finalizar sessão agora e ver seu desempenho"
        >
          <ClinicalIcon name="checkCircle" size={13} />
          <span className="hidden sm:inline">Finalizar Sessão</span>
          <span className="sm:hidden">Finalizar</span>
        </button>

        <button
          type="button"
          onClick={onToggleZenMode}
          aria-pressed={zenMode}
          className="flex items-center justify-center gap-1.5 min-h-[38px] min-w-[38px] px-2.5 py-1.5 bg-surface hover:bg-elevated text-ink-muted hover:text-ink-primary rounded-xs transition-colors border border-line-subtle text-xs font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          title={zenMode ? "Sair do Modo Zen (Tecla Z)" : "Entrar no Modo Zen - Foco Clínico Máximo (Tecla Z)"}
          aria-label={zenMode ? "Sair do Modo Zen" : "Entrar no Modo Zen"}
        >
          {zenMode ? (
            <>
              <ClinicalIcon name="minimize" size={13} /> <span className="hidden md:inline">Sair Zen</span>
            </>
          ) : (
            <>
              <ClinicalIcon name="maximize" size={13} /> <span className="hidden md:inline">Modo Zen</span>
            </>
          )}
        </button>
        <div className="min-h-[38px] px-2 py-1 bg-canvas border border-line-subtle rounded-xs flex items-center">
          <QuizTimer
            ref={quizTimerRef}
            isRunning={isTimerRunning}
            initialTime={initialTime}
            className="text-xs font-mono-lab tabular-nums font-semibold w-14 text-ink-muted"
          />
        </div>
        {hasQuestion && onToggleFavorite && (
          <button
            type="button"
            onClick={onToggleFavorite}
            className={clsx(
              "min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xs transition-colors border cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
              isFavorite
                ? "bg-critical/10 text-critical border-critical/30"
                : "bg-surface text-ink-muted hover:text-ink-primary hover:bg-elevated border-line-subtle"
            )}
            title={isFavorite ? "Remover dos Favoritos" : "Favoritar Questão"}
            aria-label={isFavorite ? "Remover dos Favoritos" : "Adicionar aos Favoritos"}
            aria-pressed={isFavorite}
          >
            <ClinicalIcon
              name="bookmark"
              size={14}
              className={isFavorite ? "fill-critical text-critical" : ""}
            />
          </button>
        )}
      </div>
    </header>
  );
});

QuizHeader.displayName = "QuizHeader";

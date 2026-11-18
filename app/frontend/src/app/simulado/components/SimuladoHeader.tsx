"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Flag, Keyboard, Scissors } from "lucide-react";
import clsx from "clsx";

export interface SimuladoHeaderProps {
  currentIndex: number;
  totalCount: number;
  answeredCount: number;
  isReview: boolean;
  isFlagged: boolean;
  onToggleFlag: () => void;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
}

export const SimuladoHeader: React.FC<SimuladoHeaderProps> = ({
  currentIndex,
  totalCount,
  answeredCount,
  isReview,
  isFlagged,
  onToggleFlag,
  onNavigatePrev,
  onNavigateNext,
}) => {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const progressPercent = totalCount > 0 ? (answeredCount / totalCount) * 100 : 0;

  return (
    <div className="relative shrink-0">
      <div className="flex items-center justify-between bg-surface border border-line-subtle rounded-lg p-3 relative overflow-hidden">
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-accent transition-all duration-300 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
        <button
          type="button"
          onClick={onNavigatePrev}
          disabled={currentIndex === 0}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md hover:bg-muted disabled:opacity-50 text-sm font-medium z-10 cursor-pointer disabled:cursor-not-allowed"
        >
          <ChevronLeft size={16} /> Anterior
        </button>
        <div className="flex items-center gap-2 z-10">
          <span className="font-semibold text-foreground font-mono-lab tabular-nums">
            Questão {currentIndex + 1} de {totalCount}
          </span>
          {!isReview && (
            <button
              type="button"
              onClick={onToggleFlag}
              className={clsx(
                "p-1.5 rounded-md transition-colors cursor-pointer",
                isFlagged
                  ? "text-warning bg-warning/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={isFlagged ? "Desmarcar revisão" : "Marcar para revisar"}
            >
              <Flag size={16} fill={isFlagged ? "currentColor" : "none"} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowShortcuts((prev) => !prev)}
            aria-expanded={showShortcuts}
            title="Atalhos de teclado"
            className="hidden sm:inline-flex p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <Keyboard size={15} />
          </button>
        </div>
        <button
          type="button"
          onClick={onNavigateNext}
          disabled={currentIndex === totalCount - 1}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md hover:bg-muted disabled:opacity-50 text-sm font-medium z-10 cursor-pointer disabled:cursor-not-allowed"
        >
          Próxima <ChevronRight size={16} />
        </button>
      </div>

      {showShortcuts && (
        <div className="absolute right-12 top-full mt-1.5 z-30 bg-surface border border-line-subtle rounded-lg shadow-lg p-3 w-72 text-xs text-muted-foreground space-y-1.5">
          <div className="flex items-center justify-between">
            <span>Selecionar alternativa</span>
            <span className="font-mono-lab text-foreground">A-E ou 1-5</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1"><Scissors size={12} /> Riscar alternativa</span>
            <span className="font-mono-lab text-foreground">Shift+A-E</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Marcar p/ revisão</span>
            <span className="font-mono-lab text-foreground">F</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Navegar questões</span>
            <span className="font-mono-lab text-foreground">Setas ← / →</span>
          </div>
        </div>
      )}
    </div>
  );
};

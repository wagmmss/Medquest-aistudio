"use client";

import React from "react";
import { Trophy, BookOpen } from "lucide-react";
import clsx from "clsx";
import { QuestionListItem, BatchAttemptResultItem } from "@/types/api";
import { SimuladoTriScorecard } from "./SimuladoTriScorecard";

export interface AreaSummaryRow {
  area: string;
  correct: number;
  total: number;
}

export interface SimuladoResultsViewProps {
  resultsMap: Record<number, BatchAttemptResultItem>;
  queue: QuestionListItem[];
  answers: Record<number, string>;
  areaSummary: AreaSummaryRow[];
  onStartReview: () => void;
  initialInstitution?: string;
}

export const SimuladoResultsView: React.FC<SimuladoResultsViewProps> = ({
  resultsMap,
  queue,
  areaSummary,
  onStartReview,
  initialInstitution = "ENARE",
}) => {
  const correctCount = queue.filter(q => Boolean(resultsMap[q.id]?.is_correct)).length;
  const percentage = queue.length > 0 ? Math.round((correctCount / queue.length) * 100) : 0;

  return (
    <div className="bg-surface border border-line-subtle rounded-lg p-6 md:p-8 flex-1 flex flex-col items-center justify-center overflow-y-auto">
      <div className="w-16 h-16 bg-success/15 text-success rounded-lg border border-success/30 flex items-center justify-center mb-5">
        <Trophy size={32} className="text-success" />
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-2">Simulado Finalizado</h2>
      <p className="text-muted-foreground text-base mb-6 text-center max-w-md">
        Você acertou <strong className="text-foreground font-mono-lab tabular-nums">{correctCount}</strong> de <strong className="text-foreground font-mono-lab tabular-nums">{queue.length}</strong> questões,
        com aproveitamento de <strong className="text-accent font-mono-lab tabular-nums">{percentage}%</strong>.
      </p>

      <div className="w-full max-w-3xl bg-canvas rounded-lg p-5 border border-line-subtle mb-6">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Desempenho por Área</h3>
        <div className="flex flex-col gap-3.5">
          {areaSummary.map(row => {
            const rowPct = row.total > 0 ? Math.round((row.correct / row.total) * 100) : 0;
            return (
              <div key={row.area}>
                <div className="flex justify-between text-sm font-medium mb-1">
                  <span>{row.area}</span>
                  <span className="text-muted-foreground font-mono-lab tabular-nums">{row.correct} / {row.total} ({rowPct}%)</span>
                </div>
                <div className="w-full bg-border h-1.5 rounded-xs overflow-hidden">
                  <div
                    className={clsx(
                      "h-full transition-all duration-500",
                      rowPct >= 80 ? "bg-success" : rowPct >= 60 ? "bg-warning" : "bg-destructive"
                    )}
                    style={{ width: `${rowPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scorecard TRI & Termômetro de Corte */}
      <SimuladoTriScorecard
        queue={queue}
        resultsMap={resultsMap}
        initialInstitution={initialInstitution}
      />

      <button
        onClick={onStartReview}
        className="bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 px-6 rounded-md transition-colors flex items-center gap-2 cursor-pointer"
      >
        <BookOpen size={18} /> Iniciar Revisão Detalhada
      </button>
    </div>
  );
};

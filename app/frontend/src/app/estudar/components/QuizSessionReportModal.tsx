"use client";

import React from "react";
import Link from "next/link";
import { CheckCircle2, Sparkles, BookOpen, RotateCcw, ArrowRight } from "lucide-react";

export interface QuizSessionReportModalProps {
  totalAnswered: number;
  correctCount: number;
  assistedCorrectCount?: number;
  accuracy: number;
  wrongItems: Array<{ question_id: number; wrong_letter: string }>;
  onBackToFilters: () => void;
  onRestartSession: () => void;
}

export const QuizSessionReportModal: React.FC<QuizSessionReportModalProps> = ({
  totalAnswered,
  correctCount,
  assistedCorrectCount = 0,
  accuracy,
  wrongItems,
  onBackToFilters,
  onRestartSession,
}) => {
  const unassistedCorrectCount = Math.max(0, correctCount - assistedCorrectCount);
  return (
    <div className="bg-surface border border-line-subtle shadow-2xs rounded-lg p-7 md:p-9 max-w-2xl mx-auto w-full text-center flex flex-col items-center animate-in zoom-in-95 duration-200">
      <div className="w-16 h-16 bg-normal-bg text-normal border border-normal/25 rounded-lg flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 size={32} />
      </div>
      <h2 className="text-2xl font-bold text-ink-primary mb-2 tracking-tight">
        Sessão Concluída
      </h2>
      <p className="text-ink-secondary text-sm sm:text-base mb-4">
        Você respondeu <strong className="font-mono-lab tabular-nums text-ink-primary">{totalAnswered}</strong> {totalAnswered === 1 ? "questão" : "questões"} com <strong className="font-mono-lab tabular-nums text-accent">{accuracy}%</strong> de acerto ({correctCount} acertos).
      </p>
      {correctCount > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2.5 mb-6 text-xs font-mono-lab tabular-nums">
          <span className="px-2.5 py-1 rounded-xs bg-normal-bg text-normal border border-normal/25 font-semibold">
            Correto direto: {unassistedCorrectCount}
          </span>
          {assistedCorrectCount > 0 && (
            <span className="px-2.5 py-1 rounded-xs bg-warning-bg text-warning border border-warning/30 font-semibold">
              Correto com ajuda (/dica): {assistedCorrectCount}
            </span>
          )}
        </div>
      )}

      {wrongItems.length > 0 && (
        <div className="w-full bg-accent/5 border border-accent/25 rounded-lg p-5 mb-7 text-left">
          <div className="flex items-center gap-2 text-accent font-mono-lab font-bold text-xs uppercase tracking-wider mb-2">
            <Sparkles size={16} />
            Repetição Espaçada de Questões (FSRS)
          </div>
          <p className="text-xs sm:text-sm text-ink-secondary leading-relaxed mb-4">
            Você errou <strong className="font-mono-lab tabular-nums text-ink-primary">{wrongItems.length}</strong> {wrongItems.length === 1 ? "questão" : "questões"} nesta sessão. Elas foram agendadas automaticamente na sua fila de revisão FSRS para consolidar a retenção de longo prazo.
          </p>
          <Link
            href="/estudar?status=wrong&limit=20"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 text-white font-semibold py-2 px-4 rounded-md text-xs transition-colors shadow-2xs cursor-pointer"
          >
            Revisar Caderno de Erros <ArrowRight size={14} />
          </Link>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
        <button
          onClick={onBackToFilters}
          className="flex-1 max-w-xs flex items-center justify-center gap-2 bg-ink-primary text-surface font-semibold py-2.5 px-5 rounded-md hover:bg-ink-primary/90 transition-colors shadow-2xs cursor-pointer text-xs"
        >
          <BookOpen size={16} /> Novo Bloco de Questões
        </button>
        <button
          onClick={onRestartSession}
          className="flex items-center justify-center gap-2 bg-elevated text-ink-primary font-semibold py-2.5 px-5 rounded-md hover:bg-line-subtle transition-colors cursor-pointer border border-line-subtle text-xs"
        >
          <RotateCcw size={16} /> Reiniciar Esta Sessão
        </button>
      </div>
    </div>
  );
};

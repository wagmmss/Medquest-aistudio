"use client";

import React, { useState } from "react";
import { OfficialExam, OfficialExamEdition } from "@/types/api";
import { Play, Download, Clock, BookOpen, Sparkles, Building2, Layers } from "lucide-react";
import clsx from "clsx";

interface SimuladoOfficialExamsProps {
  exams: OfficialExam[];
  isLoading: boolean;
  onStartExam: (institution: string, year: number, durationMinutes: number, questionsCount: number) => void;
  onDownloadExam?: (institution: string, year: number, durationMinutes: number, questionsCount: number) => void;
  isOffline: boolean;
  isDownloading: boolean;
}

const INSTITUTION_STYLING: Record<string, { bg: string; border: string; text: string; badge: string; desc: string }> = {
  "USP-SP": {
    bg: "from-blue-500/10 via-blue-500/5 to-transparent",
    border: "border-blue-500/30",
    text: "text-blue-600 dark:text-blue-400",
    badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
    desc: "120 questões · Prova longa com enunciados complexos e raciocínio fisiopatológico aprofundado.",
  },
  "USP-RP": {
    bg: "from-indigo-500/10 via-indigo-500/5 to-transparent",
    border: "border-indigo-500/30",
    text: "text-indigo-600 dark:text-indigo-400",
    badge: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
    desc: "100 questões · Casos clínicos minuciosos, condutas práticas e forte apelo propedêutico.",
  },
  "UNICAMP": {
    bg: "from-rose-500/10 via-rose-500/5 to-transparent",
    border: "border-rose-500/30",
    text: "text-rose-600 dark:text-rose-400",
    badge: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
    desc: "80-100 questões · Casos clínicos integrados, interpretação de imagens e saúde pública contemporânea.",
  },
  "UNIFESP": {
    bg: "from-cyan-500/10 via-cyan-500/5 to-transparent",
    border: "border-cyan-500/30",
    text: "text-cyan-600 dark:text-cyan-400",
    badge: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
    desc: "100 questões · Tradicional Escola Paulista: propedêutica refinada e raciocínio semiológico estrito.",
  },
  "SUS-SP": {
    bg: "from-emerald-500/10 via-emerald-500/5 to-transparent",
    border: "border-emerald-500/30",
    text: "text-emerald-600 dark:text-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    desc: "100 questões · Maior processo seletivo do país: foco em condutas de emergência, APS e protocolos do SUS.",
  },
};

export const SimuladoOfficialExams: React.FC<SimuladoOfficialExamsProps> = ({
  exams,
  isLoading,
  onStartExam,
  onDownloadExam,
  isOffline,
  isDownloading,
}) => {
  const [selectedInst, setSelectedInst] = useState<string>("USP-SP");

  const currentExam = exams.find((e) => e.institution_code === selectedInst) || exams[0];
  const styling = INSTITUTION_STYLING[selectedInst] || INSTITUTION_STYLING["USP-SP"];

  return (
    <div className="w-full flex flex-col gap-5">
      {/* Institution Tabs Selector */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-canvas border border-line-subtle rounded-lg">
        {exams.map((exam) => {
          const isSelected = exam.institution_code === selectedInst;
          const style = INSTITUTION_STYLING[exam.institution_code] || INSTITUTION_STYLING["USP-SP"];
          const editionsCount = exam.editions.length;

          return (
            <button
              key={exam.institution_code}
              type="button"
              onClick={() => setSelectedInst(exam.institution_code)}
              className={clsx(
                "flex-1 min-w-[130px] sm:min-w-[150px] py-2 px-3 rounded-md font-semibold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer",
                isSelected
                  ? "bg-surface text-foreground border border-line-subtle"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface/60"
              )}
            >
              <Building2 size={15} className={isSelected ? style.text : "text-muted-foreground"} />
              <span>{exam.name}</span>
              <span className="text-[11px] text-muted-foreground font-mono-lab tabular-nums">
                ({editionsCount})
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected Institution Banner */}
      {currentExam && (
        <div className="p-5 rounded-lg border border-line-subtle bg-surface flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className={clsx("uppercase tracking-wider", styling.text)}>
                Prova Canônica
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground font-mono-lab tabular-nums">{currentExam.editions.length} edições catalogadas</span>
            </div>
            <h2 className="text-xl font-bold text-foreground">{currentExam.full_name}</h2>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">{styling.desc}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 bg-canvas px-3 py-1.5 rounded-md border border-line-subtle font-mono-lab tabular-nums">
              <Clock size={14} className={styling.text} />
              Tempo Padrão: {Math.floor((currentExam.editions[0]?.duration_minutes || 240) / 60)}h
            </span>
          </div>
        </div>
      )}

      {/* Editions Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-44 rounded-lg bg-surface border border-line-subtle animate-pulse" />
          ))}
        </div>
      ) : currentExam && currentExam.editions.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {currentExam.editions.map((edition: OfficialExamEdition) => {
            const hours = Math.floor(edition.duration_minutes / 60);
            const minutes = edition.duration_minutes % 60;
            const formattedTime = minutes > 0 ? `${hours}h${minutes}min` : `${hours}h00`;

            return (
              <div
                key={edition.year}
                className="group bg-surface border border-line-subtle hover:border-accent/50 rounded-lg p-5 transition-colors flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-2xl font-bold text-foreground tracking-tight group-hover:text-accent transition-colors font-mono-lab tabular-nums">
                      {edition.year}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-accent/10 text-accent border border-accent/20">
                      <Sparkles size={11} /> Prova Oficial
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <BookOpen size={13} className="text-accent" /> Questões no Caderno:
                      </span>
                      <span className="font-bold text-foreground font-mono-lab tabular-nums">{edition.recommended_questions} Qs</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Clock size={13} className="text-accent" /> Duração Sugerida:
                      </span>
                      <span className="font-bold text-foreground font-mono-lab tabular-nums">{formattedTime}</span>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-line-subtle">
                      <span className="flex items-center gap-1.5">
                        <Layers size={13} /> Acervo Completo:
                      </span>
                      <span className="font-semibold text-muted-foreground font-mono-lab tabular-nums">{edition.total_available} Qs</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-line-subtle">
                  <button
                    type="button"
                    onClick={() =>
                      onStartExam(
                        currentExam.institution_code,
                        edition.year,
                        edition.duration_minutes,
                        edition.recommended_questions
                      )
                    }
                    className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold text-xs sm:text-sm py-2 px-3 rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Play size={14} fill="currentColor" /> Iniciar Prova Real
                  </button>

                  {!isOffline && onDownloadExam && (
                    <button
                      type="button"
                      title="Baixar esta prova para realizar offline"
                      onClick={() =>
                        onDownloadExam(
                          currentExam.institution_code,
                          edition.year,
                          edition.duration_minutes,
                          edition.recommended_questions
                        )
                      }
                      disabled={isDownloading}
                      className="p-2 rounded-md border border-line-subtle bg-canvas hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Download size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-surface border border-line-subtle rounded-lg p-10 text-center text-muted-foreground">
          <BookOpen className="mx-auto w-9 h-9 mb-2 opacity-50" />
          <p className="font-medium text-sm">Nenhuma edição disponível no banco para esta banca no momento.</p>
        </div>
      )}
    </div>
  );
};

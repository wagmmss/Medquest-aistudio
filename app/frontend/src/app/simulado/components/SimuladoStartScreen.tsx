"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  FileSignature,
  Play,
  RotateCcw,
  AlertTriangle,
  Sliders,
  History,
  GraduationCap
} from "lucide-react";
import { SimuladoPackage, isPackageValid } from "@/lib/db";
import { OfficialExam, SimuladoSessionItem } from "@/types/api";
import { api } from "@/lib/api";
import clsx from "clsx";
import { SimuladoCockpitHero } from "./SimuladoCockpitHero";
import { SimuladoOfficialExams } from "./SimuladoOfficialExams";

const SimuladoQuickSprints = dynamic(
  () => import("./SimuladoQuickSprints").then((m) => m.SimuladoQuickSprints),
  { loading: () => <div className="h-28 w-full rounded-lg bg-surface border border-line-subtle animate-pulse" /> }
);
const SimuladoCustomBuilder = dynamic(
  () => import("./SimuladoCustomBuilder").then((m) => m.SimuladoCustomBuilder),
  { loading: () => <div className="h-64 w-full rounded-lg bg-surface border border-line-subtle animate-pulse" /> }
);
const SimuladoHistoryView = dynamic(
  () => import("./SimuladoHistoryView").then((m) => m.SimuladoHistoryView),
  { loading: () => <div className="h-64 w-full rounded-lg bg-surface border border-line-subtle animate-pulse" /> }
);

export interface CustomConfig {
  institutions: string[];
  years: string[];
  questions_per_area: number;
  duration_minutes: number;
  force_4_options: boolean;
}

export interface SimuladoStartScreenProps {
  hasCustomFilters: boolean;
  groupedInstitutions: Array<{ base: string; codes: string[]; n: number }>;
  metaYears: number[];
  customConfig: CustomConfig;
  setCustomConfig: React.Dispatch<React.SetStateAction<CustomConfig>>;
  offlinePackage: SimuladoPackage | null;
  isOffline: boolean;
  isDownloadingPackage: boolean;
  downloadStatus: string;
  downloadProgress: number;
  onDownloadOfflineSimulado: (overrideConfig?: CustomConfig) => void;
  hasSavedState: boolean;
  clientReady: boolean;
  onResumeSimulado: () => void;
  onStartSimulado: (overrideConfig?: CustomConfig) => void;
  feedbackMode?: "exam" | "practice";
  setFeedbackMode?: (mode: "exam" | "practice") => void;
}

type TabKey = "official" | "builder" | "history";

export const SimuladoStartScreen: React.FC<SimuladoStartScreenProps> = ({
  hasCustomFilters,
  groupedInstitutions,
  metaYears,
  customConfig,
  setCustomConfig,
  offlinePackage,
  isOffline,
  isDownloadingPackage,
  downloadStatus,
  downloadProgress,
  onDownloadOfflineSimulado,
  hasSavedState,
  clientReady,
  onResumeSimulado,
  onStartSimulado,
  feedbackMode = "exam",
  setFeedbackMode = () => {},
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>("official");
  const [includeSimilar, setIncludeSimilar] = useState(false);
  const [officialExams, setOfficialExams] = useState<OfficialExam[]>([]);
  const [loadingExams, setLoadingExams] = useState(true);
  const [sessions, setSessions] = useState<SimuladoSessionItem[]>([]);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      setLoadingExams(true);
      try {
        const [examsRes, sessionsRes] = await Promise.allSettled([
          api.questions.getOfficialExams(includeSimilar),
          api.questions.getSimuladoSessions(),
        ]);

        if (isMounted) {
          if (examsRes.status === "fulfilled") {
            setOfficialExams(examsRes.value.exams || []);
          }
          if (sessionsRes.status === "fulfilled") {
            setSessions(sessionsRes.value.sessions || []);
          }
        }
      } finally {
        if (isMounted) setLoadingExams(false);
      }
    };

    void loadData();
    return () => {
      isMounted = false;
    };
  }, [includeSimilar]);

  const completedCount = sessions.length;
  const averageAccuracy =
    completedCount > 0
      ? sessions.reduce((acc, s) => acc + (s.accuracy_percent || 0), 0) / completedCount
      : 0;
  const totalTimeHours =
    sessions.reduce((acc, s) => acc + (s.elapsed_seconds || 0), 0) / 3600;

  const buildOfficialConfig = (
    institution: string,
    year: number,
    durationMinutes: number,
    questionsCount: number
  ): CustomConfig => ({
    institutions: [institution],
    years: [String(year)],
    questions_per_area: Math.max(1, Math.round(questionsCount / 5)),
    duration_minutes: durationMinutes,
    force_4_options: false,
  });

  const handleStartOfficialExam = (
    institution: string,
    year: number,
    durationMinutes: number,
    questionsCount: number
  ) => {
    const nextConfig = buildOfficialConfig(institution, year, durationMinutes, questionsCount);
    setCustomConfig(nextConfig);
    onStartSimulado(nextConfig);
  };

  const handleDownloadOfficialExam = (
    institution: string,
    year: number,
    durationMinutes: number,
    questionsCount: number
  ) => {
    const nextConfig = buildOfficialConfig(institution, year, durationMinutes, questionsCount);
    setCustomConfig(nextConfig);
    onDownloadOfflineSimulado(nextConfig);
  };

  const handleStartSprint = (
    questionsPerArea: number,
    durationMinutes: number
  ) => {
    const nextConfig: CustomConfig = {
      institutions: ["USP-SP", "USP-RP", "UNICAMP", "UNIFESP", "SUS-SP"],
      years: [],
      questions_per_area: questionsPerArea,
      duration_minutes: durationMinutes,
      force_4_options: false,
    };
    setCustomConfig(nextConfig);
    onStartSimulado(nextConfig);
  };

  if (hasCustomFilters) {
    return (
      <div className="bg-surface border border-line-subtle rounded-lg p-6 md:p-8 max-w-3xl mx-auto w-full flex flex-col items-center">
        <div className="w-12 h-12 bg-accent/10 text-accent rounded-lg border border-accent/20 flex items-center justify-center mb-5">
          <FileSignature size={24} />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2 text-center tracking-tight">
          Simulado Personalizado
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base mb-6 max-w-lg text-center leading-relaxed">
          Esta prova irá simular as condições oficiais de exame usando o caderno de filtros que você selecionou.
        </p>

        <div className="bg-warning/10 text-warning-foreground border border-warning/20 rounded-md p-4 flex items-start gap-3 w-full max-w-lg mb-6 text-left text-sm">
          <AlertTriangle size={18} className="shrink-0 mt-0.5 text-warning" />
          <p className="font-medium text-warning-foreground/90 leading-relaxed text-xs sm:text-sm">
            Este é um bloco de prova cronometrado. O feedback e o cálculo do seu desempenho TRI serão consolidados após a entrega final.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-lg">
          {hasSavedState && (
            <button
              onClick={onResumeSimulado}
              disabled={!clientReady}
              aria-label="Continuar Simulado em Andamento"
              className="flex-1 bg-muted hover:bg-muted/80 text-foreground font-semibold py-3 px-6 rounded-md transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <RotateCcw size={16} />
              Continuar Andamento
            </button>
          )}
          <button
            onClick={() => onStartSimulado()}
            disabled={!clientReady}
            className="flex-1 bg-accent hover:bg-accent/90 text-white font-semibold py-3 px-6 rounded-md transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <Play size={16} fill="currentColor" />
            Iniciar Agora
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto flex flex-col items-center pb-12">
      <SimuladoCockpitHero
        completedCount={completedCount}
        averageAccuracy={averageAccuracy}
        totalTimeHours={totalTimeHours}
        isOffline={isOffline}
        hasOfflinePackage={Boolean(offlinePackage && isPackageValid(offlinePackage).valid)}
      />

      {hasSavedState && (
        <div className="w-full mb-6 p-4 rounded-lg bg-accent/10 border border-accent/30 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-left">
            <div className="w-9 h-9 rounded-md bg-accent text-white flex items-center justify-center shrink-0">
              <RotateCcw size={18} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-foreground">Você tem um simulado em andamento</h4>
              <p className="text-xs text-muted-foreground">
                Suas respostas e o cronômetro foram salvos com segurança. Retome exatamente de onde parou.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onResumeSimulado}
            disabled={!clientReady}
            className="w-full sm:w-auto px-4 py-2 rounded-md bg-accent hover:bg-accent/90 text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Play size={14} fill="currentColor" /> Retomar Simulado
          </button>
        </div>
      )}

      {/* Cockpit Navigation Tabs (3 consolidated tabs) */}
      <div className="w-full flex items-center justify-start sm:justify-center border-b border-line-subtle mb-6 overflow-x-auto no-scrollbar gap-1 sm:gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("official")}
          className={clsx(
            "flex items-center gap-2 py-3 px-4 font-semibold text-xs sm:text-sm border-b-2 transition-colors cursor-pointer whitespace-nowrap",
            activeTab === "official"
              ? "border-accent text-accent"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-line-subtle"
          )}
        >
          <GraduationCap size={17} />
          <span>Provas na Íntegra</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("builder")}
          className={clsx(
            "flex items-center gap-2 py-3 px-4 font-semibold text-xs sm:text-sm border-b-2 transition-colors cursor-pointer whitespace-nowrap",
            activeTab === "builder"
              ? "border-accent text-accent"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-line-subtle"
          )}
        >
          <Sliders size={17} />
          <span>Personalizado &amp; Sprints</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={clsx(
            "flex items-center gap-2 py-3 px-4 font-semibold text-xs sm:text-sm border-b-2 transition-colors cursor-pointer whitespace-nowrap",
            activeTab === "history"
              ? "border-accent text-accent"
              : "border-transparent text-muted-foreground hover:text-foreground hover:border-line-subtle"
          )}
        >
          <History size={17} />
          <span>Histórico &amp; Caderno</span>
          {completedCount > 0 && (
            <span className="text-[11px] font-mono-lab tabular-nums text-muted-foreground">
              ({completedCount})
            </span>
          )}
        </button>
      </div>

      <div className="w-full">
        {activeTab === "official" && (
          <div className="space-y-4">
            <label className="inline-flex items-center gap-2.5 text-xs font-medium text-ink-primary bg-surface border border-line-subtle rounded-xs px-3 py-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeSimilar}
                onChange={(e) => setIncludeSimilar(e.target.checked)}
                className="rounded-xs accent-accent cursor-pointer"
              />
              <span>Incluir instituições similares (ENARE, Einstein, Sírio-Libanês, FAMEMA, FAMERP, IAMSPE, Santa Casa)</span>
            </label>
            <SimuladoOfficialExams
              exams={officialExams}
              isLoading={loadingExams}
              onStartExam={handleStartOfficialExam}
              onDownloadExam={handleDownloadOfficialExam}
              isOffline={isOffline}
              isDownloading={isDownloadingPackage}
            />
          </div>
        )}

        {activeTab === "builder" && (
          <div className="space-y-6">
            <SimuladoQuickSprints onStartSprint={handleStartSprint} />
            <SimuladoCustomBuilder
              customConfig={customConfig}
              setCustomConfig={setCustomConfig}
              groupedInstitutions={groupedInstitutions}
              metaYears={metaYears}
              feedbackMode={feedbackMode}
              setFeedbackMode={setFeedbackMode}
              onStartSimulado={() => onStartSimulado()}
              onDownloadOfflineSimulado={() => onDownloadOfflineSimulado()}
              isDownloadingPackage={isDownloadingPackage}
              downloadStatus={downloadStatus}
              downloadProgress={downloadProgress}
              isOffline={isOffline}
            />
          </div>
        )}

        {activeTab === "history" && (
          <SimuladoHistoryView />
        )}
      </div>
    </div>
  );
};

"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import { Calendar, RefreshCcw } from "lucide-react";
import type {
  AtRiskTopic,
  BlindspotsResponse,
  DistractorStat,
  InstitutionRadarResponse,
  LearningProfile,
  OverviewStats,
  TimelineStat,
  WeakTopic,
} from "@/types/api";
import { sliceTimelineByDays } from "@/lib/analysisTimeline";
import { InstitutionRadarSection } from "@/components/analytics/InstitutionRadarSection";
import { BlindspotsRadarSection } from "@/components/analytics/BlindspotsRadarSection";
import { TimelineEvolutionChart } from "./TimelineEvolutionChart";
import { FsrsAndWeakTopicsGrid } from "./FsrsAndWeakTopicsGrid";

interface PerformanceRadarTabProps {
  overview?: OverviewStats;
  learningProfile: LearningProfile;
  selectedInstitution: string;
  institutionOptions: { key: string; label: string }[];
  institutionRadar?: InstitutionRadarResponse | null;
  blindspots?: BlindspotsResponse | null;
  timeline180: TimelineStat[];
  atRiskTopics: AtRiskTopic[];
  weakTopics: WeakTopic[];
  distractors: DistractorStat[];
  timelineError?: string | null;
  loadingTimeline?: boolean;
  onRefreshTimeline?: () => void;
}

export function PerformanceRadarTab({
  overview,
  selectedInstitution,
  institutionOptions,
  institutionRadar,
  blindspots,
  timeline180,
  atRiskTopics,
  timelineError = null,
  loadingTimeline = false,
  onRefreshTimeline,
}: PerformanceRadarTabProps) {
  const [days, setDays] = useState<number>(14);
  const [timelineMode, setTimelineMode] = useState<"all" | "latest">("all");
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const visibleTimeline = useMemo(
    () => sliceTimelineByDays(timeline180, days),
    [timeline180, days]
  );

  const chartTimeline = useMemo(
    () =>
      visibleTimeline.map((t) => {
        const useLatest = timelineMode === "latest";
        const rawAcc = useLatest ? (t.latest_accuracy ?? t.accuracy) : t.accuracy;
        const count = useLatest ? (t.latest_attempts ?? t.attempts) : t.attempts;
        return {
          ...t,
          attempts: count,
          dateShort: t.day.split("-").slice(1).reverse().join("/"),
          accPct: parseFloat(((rawAcc || 0) * 100).toFixed(1)),
        };
      }),
    [visibleTimeline, timelineMode]
  );

  const periodPaceStats = useMemo(() => {
    let totalAttempts = 0;
    let totalCorrect = 0;
    let assistedCorrect = 0;
    let totalTimeMs = 0;
    let timedAttempts = 0;

    for (const t of visibleTimeline) {
      const count = timelineMode === "latest" ? (t.latest_attempts ?? t.attempts) : t.attempts;
      const correct = timelineMode === "latest" ? (t.latest_correct ?? t.correct) : t.correct;
      totalAttempts += count || 0;
      totalCorrect += correct || 0;
      assistedCorrect += t.assisted_correct ?? 0;
      totalTimeMs += t.total_time_ms || 0;
      timedAttempts += t.timed_attempts || 0;
    }

    if (visibleTimeline.length === 0 && overview?.assisted_correct_count) {
      assistedCorrect = overview.assisted_correct_count;
    }
    const unassistedCorrect = Math.max(0, totalCorrect - assistedCorrect);

    const avgSeconds = timedAttempts > 0 ? Math.round(totalTimeMs / timedAttempts / 1000) : null;
    const totalMinutes = totalTimeMs > 0 ? Math.round(totalTimeMs / 60000) : 0;
    const periodAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : null;

    return {
      totalAttempts,
      totalCorrect,
      assistedCorrect,
      unassistedCorrect,
      avgSeconds,
      totalMinutes,
      periodAccuracy,
    };
  }, [visibleTimeline, timelineMode, overview]);

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* Radar Comparativo de Bancas */}
      <InstitutionRadarSection
        initialData={institutionRadar}
        institutionOptions={institutionOptions}
        defaultInstitution={selectedInstitution || "USP-SP"}
      />

      {/* Radar de Pontos Cegos & Caderno de Erros */}
      <BlindspotsRadarSection initialData={blindspots} />

      {/* Timeline (in-memory slice from timeline_180) */}
      <section className="bg-surface border border-line-subtle rounded-lg p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-ink-primary">
              Evolução: volume e acurácia diária
            </h2>
            <p className="text-xs text-ink-muted">
              Acurácia diária oscila com amostras pequenas; avalie a tendência junto com o volume.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Modo de cálculo da acurácia"
              className="flex items-center gap-1 bg-elevated/60 p-1 rounded-xl border border-line-subtle"
            >
              <button
                type="button"
                onClick={() => setTimelineMode("all")}
                aria-pressed={timelineMode === "all"}
                className={clsx(
                  "px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer min-h-[38px]",
                  timelineMode === "all"
                    ? "bg-surface text-ink-primary shadow-xs border border-line-subtle"
                    : "text-ink-muted hover:text-ink-primary"
                )}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setTimelineMode("latest")}
                aria-pressed={timelineMode === "latest"}
                className={clsx(
                  "px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer min-h-[38px]",
                  timelineMode === "latest"
                    ? "bg-surface text-ink-primary shadow-xs border border-line-subtle"
                    : "text-ink-muted hover:text-ink-primary"
                )}
              >
                Última tentativa
              </button>
            </div>

            <div className="flex items-center gap-1.5 bg-elevated/60 p-1 rounded-xl border border-line-subtle">
              {[14, 30, 90, 180].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  disabled={loadingTimeline}
                  aria-pressed={days === d}
                  aria-label={`Ver evolução de ${d} dias`}
                  className={clsx(
                    "px-2.5 py-1.5 text-xs font-mono-lab font-semibold rounded-lg transition-colors cursor-pointer min-h-[38px] min-w-[44px] inline-flex items-center justify-center",
                    days === d
                      ? "bg-surface text-ink-primary shadow-xs border border-line-subtle"
                      : "text-ink-muted hover:text-ink-primary",
                    loadingTimeline && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {d}D
                </button>
              ))}
              {onRefreshTimeline && (
                <button
                  type="button"
                  onClick={onRefreshTimeline}
                  disabled={loadingTimeline}
                  aria-label="Atualizar histórico de evolução"
                  title="Atualizar histórico"
                  className="p-1.5 min-h-[38px] min-w-[38px] rounded-lg text-ink-muted hover:text-ink-primary transition-colors inline-flex items-center justify-center cursor-pointer disabled:opacity-50"
                >
                  <RefreshCcw
                    size={14}
                    className={loadingTimeline ? "animate-spin text-primary" : undefined}
                  />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Faixa de KPIs do Período (Ritmo & Acurácia) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-canvas border border-line-subtle rounded-xl px-3.5 py-2.5">
            <p className="text-[11px] text-ink-secondary font-medium">Questões no período</p>
            <p className="text-base font-bold text-ink-primary font-mono-lab tabular-nums">
              {periodPaceStats.totalAttempts}
            </p>
          </div>
          <div className="bg-canvas border border-line-subtle rounded-xl px-3.5 py-2.5">
            <p className="text-[11px] text-ink-secondary font-medium">
              {timelineMode === "latest" ? "Acurácia (última)" : "Acurácia (geral)"}
            </p>
            <p className="text-base font-bold text-ink-primary font-mono-lab tabular-nums">
              {periodPaceStats.periodAccuracy !== null ? `${periodPaceStats.periodAccuracy}%` : "—"}
            </p>
            {periodPaceStats.totalCorrect > 0 && (
              <p className="text-[10px] font-mono-lab text-ink-muted mt-0.5 tabular-nums">
                {periodPaceStats.unassistedCorrect} correto · {periodPaceStats.assistedCorrect} c/ ajuda
              </p>
            )}
          </div>
          <div className="bg-canvas border border-line-subtle rounded-xl px-3.5 py-2.5">
            <p className="text-[11px] text-ink-secondary font-medium">Tempo / Questão</p>
            <p className="text-base font-bold text-ink-primary font-mono-lab tabular-nums">
              {periodPaceStats.avgSeconds !== null ? `${periodPaceStats.avgSeconds}s` : "—"}
            </p>
          </div>
          <div className="bg-canvas border border-line-subtle rounded-xl px-3.5 py-2.5">
            <p className="text-[11px] text-ink-secondary font-medium">Tempo Total</p>
            <p className="text-base font-bold text-ink-primary font-mono-lab tabular-nums">
              {periodPaceStats.totalMinutes > 0
                ? periodPaceStats.totalMinutes >= 60
                  ? `${Math.floor(periodPaceStats.totalMinutes / 60)}h ${periodPaceStats.totalMinutes % 60}m`
                  : `${periodPaceStats.totalMinutes}m`
                : "—"}
            </p>
          </div>
        </div>

        {timelineError ? (
          <div
            role="alert"
            className="p-3 rounded-md bg-destructive/10 border border-destructive/25 text-xs text-destructive flex items-center justify-between"
          >
            <span>{timelineError}</span>
            {onRefreshTimeline && (
              <button
                type="button"
                disabled={loadingTimeline}
                onClick={onRefreshTimeline}
                className="font-semibold underline ml-2 cursor-pointer"
              >
                Tentar novamente
              </button>
            )}
          </div>
        ) : (
          <div aria-busy={loadingTimeline}>
            <p className="text-xs text-ink-muted mb-3 font-mono-lab">
              Dados exibidos: últimos {days} dias{loadingTimeline ? " · Atualizando…" : ""}
            </p>
            <div className="h-[340px] w-full min-w-0 border border-line-subtle rounded-md bg-canvas p-4 flex flex-col">
              {chartTimeline.length > 0 ? (
                <div className="flex-1 min-h-0 w-full">
                  <TimelineEvolutionChart data={chartTimeline} />
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-ink-muted gap-2 text-sm">
                  <p>Nenhuma atividade registrada neste recorte de {days} dias.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Heatmap de Consistência (Últimos 6 meses) */}
      <section className="bg-surface border border-line-subtle rounded-lg p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 text-ink-primary">
            <Calendar className="w-4 h-4 text-primary" aria-hidden="true" />
            <h3 className="text-base font-bold text-ink-primary">
              Histórico de Atividade (Últimos 6 meses)
            </h3>
          </div>
          <span className="text-xs text-ink-muted hidden sm:inline-block font-mono-lab">
            Consistência e volume diário
          </span>
        </div>

        {(() => {
          if (!isMounted) {
            return <div className="w-full h-[105px] bg-elevated/60 rounded-md" />;
          }
          if (!timeline180 || timeline180.length === 0) {
            return (
              <p className="text-sm text-ink-muted py-6 text-center">
                Nenhuma atividade registrada nos últimos 6 meses.
              </p>
            );
          }
          const today = new Date();
          const daysCount = 180;
          const startDate = new Date(today.getTime() - (daysCount - 1) * 24 * 60 * 60 * 1000);
          startDate.setDate(startDate.getDate() - startDate.getDay());
          const totalDays =
            Math.floor((today.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

          const activityMap = new Map<string, number>();
          timeline180.forEach((t) => {
            activityMap.set(t.day, t.attempts);
          });

          const grid = [];
          for (let i = 0; i < totalDays; i++) {
            const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
            const dateStr = d.toISOString().split("T")[0];
            const count = activityMap.get(dateStr) || 0;

            let colorClass = "bg-elevated";
            if (count > 0 && count <= 10) colorClass = "bg-primary/30";
            else if (count > 10 && count <= 30) colorClass = "bg-primary/50";
            else if (count > 30 && count <= 60) colorClass = "bg-primary/75";
            else if (count > 60) colorClass = "bg-primary";

            grid.push(
              <div
                key={dateStr}
                title={`${dateStr}: ${count} questões`}
                className={clsx(
                  "w-[13px] h-[13px] rounded-xs transition-colors hover:ring-2 ring-primary/50",
                  colorClass
                )}
              />
            );
          }

          return (
            <div className="w-full overflow-x-auto pb-2 scrollbar-thin">
              <div className="flex flex-col flex-wrap gap-1 h-[105px] min-w-max content-start">
                {grid}
              </div>
              <div className="flex items-center justify-between text-[11px] text-ink-muted mt-3 pt-2 border-t border-line-subtle font-mono-lab">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-xs bg-elevated" /> 0
                  <span className="w-2.5 h-2.5 rounded-xs bg-primary/30 ml-2" /> 1-10
                  <span className="w-2.5 h-2.5 rounded-xs bg-primary/50 ml-1" /> 11-30
                  <span className="w-2.5 h-2.5 rounded-xs bg-primary/75 ml-1" /> 31-60
                  <span className="w-2.5 h-2.5 rounded-xs bg-primary ml-1" /> 60+
                </span>
                <span>180 dias</span>
              </div>
            </div>
          );
        })()}
      </section>

      <FsrsAndWeakTopicsGrid atRiskTopics={atRiskTopics} />
    </div>
  );
}

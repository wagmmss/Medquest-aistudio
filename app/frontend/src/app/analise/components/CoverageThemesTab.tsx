"use client";

import { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock,
  Flame,
  PlayCircle,
  RefreshCcw,
  Search,
  Sparkles,
} from "lucide-react";
import type {
  CoverageArea,
  CoverageSubtema,
  LearningProfileTopic,
} from "@/types/api";
import { normalizeTopicSearch } from "@/lib/analysisTimeline";

const ThemeDetailDrawer = dynamic(
  () => import("./ThemeDetailDrawer").then((m) => m.ThemeDetailDrawer),
  { ssr: false }
);

type StatusFilter = "all" | "high_yield" | "evidence" | "in_progress" | "not_started";

function formatCoverage(sub: CoverageSubtema) {
  return `${sub.answered}/${sub.n_questions} (${(sub.coverage_pct * 100).toFixed(0)}%)`;
}

interface CoverageThemesTabProps {
  initialAreas: CoverageArea[];
  learningTopics: LearningProfileTopic[];
  initialSubtema?: string | null;
  onSelectSubtema?: (subtema: string | null) => void;
  initialError?: string | null;
}

export function CoverageThemesTab({
  initialAreas,
  learningTopics,
  initialSubtema = null,
  onSelectSubtema,
  initialError = null,
}: CoverageThemesTabProps) {
  const queryClient = useQueryClient();
  const areas = initialAreas;
  const [error, setError] = useState<string | null>(initialError);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedArea, setExpandedArea] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [localSubtema, setLocalSubtema] = useState<string | null>(initialSubtema);
  const activeSubtema = onSelectSubtema ? initialSubtema : localSubtema;

  const openSubtemaDrawer = (subtema: string | null) => {
    if (onSelectSubtema) {
      onSelectSubtema(subtema);
    } else {
      setLocalSubtema(subtema);
    }
  };

  const toggleArea = (area: string) =>
    setExpandedArea((prev) => (prev === area ? null : area));

  const refreshCoverage = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      await queryClient.invalidateQueries({ queryKey: ["analysis-summary"] });
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Falha ao atualizar dados de cobertura"
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  const getStatusTag = (status: CoverageSubtema["status"]) => {
    if (status === "mastered") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] font-semibold bg-success/10 text-success border border-success/25 whitespace-nowrap">
          <CheckCircle2 size={12} /> Consolidado
        </span>
      );
    }
    if (status === "proficient") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] font-semibold bg-primary/10 text-primary border border-primary/25 whitespace-nowrap">
          <Sparkles size={12} /> Boa evidência
        </span>
      );
    }
    if (status === "in_progress") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] font-semibold bg-warning/10 text-warning border border-warning/25 whitespace-nowrap">
          <PlayCircle size={12} /> Em aprendizado
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[11px] font-medium bg-surface-subtle text-muted-foreground border border-line-subtle whitespace-nowrap">
        <CircleDashed size={12} /> Não iniciado
      </span>
    );
  };

  const getAreaColorClass = (areaName: string) => {
    const name = areaName.toLowerCase();
    if (name.includes("preventiva")) return "bg-area-preventiva";
    if (name.includes("pediatria")) return "bg-area-pediatria";
    if (name.includes("go") || name.includes("ginecologia")) return "bg-area-go";
    if (name.includes("cirurgia")) return "bg-area-cirurgia";
    return "bg-area-clinica";
  };

  const normalizedQuery = useMemo(
    () => normalizeTopicSearch(searchQuery.trim()),
    [searchQuery]
  );

  const filteredAreas = useMemo(
    () =>
      areas.map((area) => {
        const subs = area.subtemas || [];
        const filteredSubtemas = subs.filter((sub) => {
          if (normalizedQuery) {
            const matchesSubtema = normalizeTopicSearch(sub.subtema).includes(
              normalizedQuery
            );
            const matchesArea = normalizeTopicSearch(
              sub.area || area.area
            ).includes(normalizedQuery);
            if (!matchesSubtema && !matchesArea) return false;
          }
          if (statusFilter === "high_yield") return Boolean(sub.highYield);
          if (statusFilter === "evidence")
            return sub.status === "mastered" || sub.status === "proficient";
          if (statusFilter === "in_progress") return sub.status === "in_progress";
          if (statusFilter === "not_started") return sub.status === "not_started";
          return true;
        });
        return { ...area, filteredSubtemas };
      }),
    [areas, normalizedQuery, statusFilter]
  );

  const {
    totalSubtemas,
    totalHighYield,
    highYieldMastered,
    totalWithEvidence,
    totalInProgress,
    totalQuestions,
    totalAnswered,
  } = useMemo(() => {
    return {
      totalSubtemas: areas.reduce((acc, a) => acc + (a.n_subtemas || 0), 0),
      totalHighYield: areas.reduce((acc, a) => acc + (a.high_yield_count || 0), 0),
      highYieldMastered: areas.reduce((acc, a) => acc + (a.high_yield_mastered || 0), 0),
      totalWithEvidence: areas.reduce(
        (acc, a) => acc + (a.mastered || 0) + (a.proficient || 0),
        0
      ),
      totalInProgress: areas.reduce((acc, a) => acc + (a.in_progress || 0), 0),
      totalQuestions: areas.reduce((acc, a) => acc + (a.n_questions || 0), 0),
      totalAnswered: areas.reduce((acc, a) => acc + (a.answered_questions || 0), 0),
    };
  }, [areas]);

  const globalCoveragePct =
    totalQuestions > 0 ? ((totalAnswered / totalQuestions) * 100).toFixed(1) : "0.0";

  const activeCoverageSubtema = activeSubtema
    ? areas
        .flatMap((area) =>
          (area.subtemas || []).map((s) => ({
            ...s,
            area: s.area || area.area,
          }))
        )
        .find((s) => s.subtema === activeSubtema) ?? null
    : null;

  const activeLearningTopic = activeSubtema
    ? learningTopics.find((t) => t.topic === activeSubtema) ?? null
    : null;

  if (areas.length === 0 && error) {
    return (
      <div className="bg-surface border border-destructive/30 rounded-lg p-8 text-center flex flex-col items-center justify-center gap-4 max-w-xl mx-auto">
        <AlertTriangle size={24} className="text-destructive" />
        <div>
          <h2 className="text-base font-bold text-foreground mb-1">
            Não foi possível carregar a cobertura
          </h2>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
        <button
          type="button"
          onClick={refreshCoverage}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer disabled:opacity-60"
        >
          <RefreshCcw size={14} className={isRefreshing ? "animate-spin" : undefined} />
          {isRefreshing ? "Tentando novamente..." : "Tentar novamente"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* Compact Coverage KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface border border-line-subtle rounded-lg p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Catálogo Estruturado
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-mono-lab tabular-nums font-bold text-foreground">
              {totalSubtemas}
            </span>
            <span className="text-xs text-muted-foreground">
              módulos · {totalQuestions.toLocaleString()} questões
            </span>
          </div>
        </div>

        <div className="bg-surface border border-line-subtle rounded-lg p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-warning flex items-center gap-1">
            <Flame size={12} /> Alta Incidência (USP-SP / RP)
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-mono-lab tabular-nums font-bold text-foreground">
              {totalHighYield}
            </span>
            <span className="text-xs text-muted-foreground font-mono-lab tabular-nums">
              {highYieldMastered} consolidados
            </span>
          </div>
        </div>

        <div className="bg-surface border border-line-subtle rounded-lg p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cobertura Global do Banco
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-mono-lab tabular-nums font-bold text-foreground">
              {globalCoveragePct}%
            </span>
            <span className="text-xs text-muted-foreground font-mono-lab tabular-nums">
              ({totalAnswered}/{totalQuestions})
            </span>
          </div>
          <div className="h-1.5 w-full bg-surface-subtle rounded-xs overflow-hidden mt-2">
            <div className="h-full bg-success" style={{ width: `${globalCoveragePct}%` }} />
          </div>
        </div>
      </div>

      {/* Transient error banner */}
      {error && areas.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/25 text-destructive px-4 py-3 rounded-md flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={refreshCoverage}
            disabled={isRefreshing}
            className="font-semibold underline ml-4 cursor-pointer"
          >
            {isRefreshing ? "Atualizando..." : "Tentar novamente"}
          </button>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="bg-surface border border-line-subtle rounded-lg p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Buscar tema ou módulo..."
            aria-label="Buscar tema ou módulo"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-canvas border border-line-subtle rounded-md text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {[
            ["all", `Todos (${totalSubtemas})`],
            ["high_yield", `Alta incidência (${totalHighYield})`],
            ["evidence", `Boa evidência (${totalWithEvidence})`],
            ["in_progress", `Em aprendizado (${totalInProgress})`],
            ["not_started", "Não iniciados"],
          ].map(([value, label]) => {
            const isSelected = statusFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value as StatusFilter)}
                aria-pressed={isSelected}
                className={clsx(
                  "px-3 py-1.5 min-h-[38px] rounded-md text-xs font-semibold transition-colors shrink-0 inline-flex items-center justify-center cursor-pointer border",
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-elevated/60 hover:bg-elevated text-ink-secondary border-line-subtle"
                )}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={refreshCoverage}
            disabled={isRefreshing}
            aria-label="Atualizar dados de cobertura"
            title="Atualizar dados de cobertura"
            className="p-2 min-h-[38px] min-w-[38px] rounded-md bg-elevated/60 border border-line-subtle hover:bg-elevated text-ink-secondary transition-colors shrink-0 inline-flex items-center justify-center cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw
              size={14}
              className={isRefreshing ? "animate-spin text-primary" : undefined}
            />
          </button>
        </div>
      </div>

      {/* Area Accordions */}
      {filteredAreas.some((a) => a.filteredSubtemas.length > 0) ? (
        <div className="flex flex-col gap-3">
          {filteredAreas.map((area) => {
            const isExpanded =
              expandedArea === area.area || normalizedQuery.length > 0;
            const coveragePct =
              area.n_questions > 0
                ? (area.answered_questions / area.n_questions) * 100
                : 0;
            if (
              area.filteredSubtemas.length === 0 &&
              (normalizedQuery || statusFilter !== "all")
            ) {
              return null;
            }

            return (
              <div
                key={area.area}
                className="bg-surface border border-line-subtle rounded-lg flex flex-col overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleArea(area.area)}
                  aria-expanded={isExpanded}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 md:p-5 hover:bg-elevated/40 transition-colors gap-4 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={clsx(
                        "w-2 h-10 rounded-xs shrink-0",
                        getAreaColorClass(area.area)
                      )}
                    />
                    <div>
                      <h3 className="text-base font-bold text-ink-primary">
                        {area.area}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted mt-0.5 font-mono-lab tabular-nums">
                        <span>{area.n_subtemas} módulos</span>
                        <span>·</span>
                        <span>{area.n_questions} questões</span>
                        {area.high_yield_count ? (
                          <>
                            <span>·</span>
                            <span className="text-warning font-semibold inline-flex items-center gap-1">
                              <Flame size={11} /> {area.high_yield_count} alta incidência
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 sm:gap-5 w-full sm:w-auto sm:min-w-[320px]">
                    <div className="flex-1">
                      <div className="flex justify-between text-[11px] uppercase tracking-wider mb-1.5 font-semibold">
                        <span className="text-ink-muted">Cobertura</span>
                        <span className="text-ink-primary font-mono-lab tabular-nums">
                          {coveragePct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 w-full bg-elevated rounded-xs overflow-hidden">
                        <div
                          className="h-full bg-success transition-all duration-300"
                          style={{ width: `${coveragePct}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col items-end border-l border-line-subtle pl-4">
                      <span className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold mb-0.5">
                        Consolidados
                      </span>
                      <span className="text-lg font-mono-lab tabular-nums font-bold text-ink-primary leading-none">
                        {area.mastered}/{area.n_subtemas}
                      </span>
                    </div>
                    <div className="text-ink-muted">
                      {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-line-subtle bg-canvas p-3 sm:p-4">
                    {/* Slimmed 6-Column Desktop Table */}
                    <div className="hidden md:block overflow-x-auto rounded-md border border-line-subtle bg-surface">
                      <table className="w-full text-sm text-left">
                        <thead className="text-[11px] text-ink-muted uppercase tracking-wider bg-elevated/60 border-b border-line-subtle">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Módulo / Tema</th>
                            <th className="px-3 py-3 font-semibold text-center">Teoria</th>
                            <th className="px-3 py-3 font-semibold text-right">Cobertura & Amostra</th>
                            <th className="px-3 py-3 font-semibold text-right">Acurácia</th>
                            <th className="px-3 py-3 font-semibold text-center">Status</th>
                            <th className="px-4 py-3 font-semibold text-center">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line-subtle">
                          {area.filteredSubtemas.map((sub) => {
                            const unansweredParam =
                              sub.answered < sub.n_questions ? "true" : "false";
                            return (
                              <tr
                                key={sub.subtema}
                                className="hover:bg-elevated/40 transition-colors"
                              >
                                <td className="px-4 py-3 font-medium text-ink-primary">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <button
                                      type="button"
                                      onClick={() => openSubtemaDrawer(sub.subtema)}
                                      className="text-left hover:text-primary hover:underline cursor-pointer"
                                    >
                                      {sub.subtema}
                                    </button>
                                    {sub.highYield && (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-bold bg-warning/10 text-warning border border-warning/25">
                                        <Flame size={10} /> Alta
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-center text-xs text-ink-muted font-mono-lab whitespace-nowrap">
                                  {sub.theory_hours ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-elevated/60 border border-line-subtle">
                                      <Clock size={11} /> {sub.theory_hours}h
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="px-3 py-3 text-right whitespace-nowrap">
                                  <div className="flex flex-col items-end">
                                    <span className="text-xs font-mono-lab tabular-nums font-semibold text-ink-primary">
                                      {formatCoverage(sub)}
                                    </span>
                                    <span className="text-[11px] font-mono-lab tabular-nums text-ink-muted">
                                      {sub.attempts} tent.
                                    </span>
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-right font-mono-lab tabular-nums font-bold text-ink-primary whitespace-nowrap">
                                  {sub.accuracy != null
                                    ? `${(sub.accuracy * 100).toFixed(0)}%`
                                    : "—"}
                                </td>
                                <td className="px-3 py-3 text-center whitespace-nowrap">
                                  {getStatusTag(sub.status)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openSubtemaDrawer(sub.subtema)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-ink-primary bg-elevated/60 hover:bg-elevated border border-line-subtle rounded-xs cursor-pointer"
                                      aria-label={`Ver detalhes de ${sub.subtema}`}
                                    >
                                      Detalhes
                                    </button>
                                    <Link
                                      href={`/estudar?area=${encodeURIComponent(
                                        sub.area || area.area
                                      )}&subtema=${encodeURIComponent(
                                        sub.subtema
                                      )}&limit=10&unanswered_only=${unansweredParam}`}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-xs whitespace-nowrap"
                                    >
                                      <PlayCircle size={13} /> Treinar (10q)
                                    </Link>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="md:hidden flex flex-col gap-2.5">
                      {area.filteredSubtemas.map((sub) => {
                        const unansweredParam =
                          sub.answered < sub.n_questions ? "true" : "false";
                        const subCovPct =
                          sub.n_questions > 0
                            ? (sub.answered / sub.n_questions) * 100
                            : 0;
                        return (
                          <div
                            key={sub.subtema}
                            className="bg-surface border border-line-subtle rounded-md p-3.5 flex flex-col gap-2.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => openSubtemaDrawer(sub.subtema)}
                                className="font-semibold text-sm text-ink-primary text-left hover:text-primary"
                              >
                                {sub.subtema}
                              </button>
                              {sub.highYield && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-bold bg-warning/10 text-warning border border-warning/25 shrink-0">
                                  <Flame size={10} /> Alta
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              {getStatusTag(sub.status)}
                              {sub.theory_hours ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-elevated/60 text-[11px] font-mono-lab text-ink-muted">
                                  <Clock size={11} /> {sub.theory_hours}h
                                </span>
                              ) : null}
                            </div>

                            <div className="bg-canvas rounded-xs p-2.5 flex flex-col gap-1.5 border border-line-subtle">
                              <div className="flex justify-between text-xs">
                                <span className="text-ink-muted">Cobertura:</span>
                                <span className="font-mono-lab tabular-nums font-semibold text-ink-primary">
                                  {formatCoverage(sub)}
                                </span>
                              </div>
                              <div className="h-1.5 w-full bg-elevated rounded-xs overflow-hidden">
                                <div
                                  className="h-full bg-success"
                                  style={{ width: `${subCovPct}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-xs pt-1 border-t border-line-subtle font-mono-lab tabular-nums text-ink-secondary">
                                <span>
                                  Acurácia:{" "}
                                  <strong className="text-ink-primary">
                                    {sub.accuracy != null
                                      ? `${(sub.accuracy * 100).toFixed(0)}%`
                                      : "—"}
                                  </strong>
                                </span>
                                <span>{sub.attempts} tent.</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openSubtemaDrawer(sub.subtema)}
                                className="min-h-[38px] px-3 py-2 text-xs font-semibold border border-line-subtle rounded-md bg-elevated/60 text-ink-primary cursor-pointer"
                              >
                                Detalhes
                              </button>
                              <Link
                                href={`/estudar?area=${encodeURIComponent(
                                  sub.area || area.area
                                )}&subtema=${encodeURIComponent(
                                  sub.subtema
                                )}&limit=10&unanswered_only=${unansweredParam}`}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 py-2 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md"
                              >
                                <PlayCircle size={14} /> Treinar (10q)
                              </Link>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-surface border border-dashed border-line-subtle rounded-lg p-10 text-center flex flex-col items-center justify-center gap-3">
          <Search size={22} className="text-ink-muted" />
          <h3 className="font-bold text-sm text-ink-primary">
            Nenhum módulo encontrado
          </h3>
          <p className="text-xs text-ink-muted max-w-sm">
            Nenhum módulo corresponde aos filtros selecionados.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
            }}
            className="text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 min-h-[38px] px-3 py-1.5 rounded-md cursor-pointer"
          >
            Limpar filtros
          </button>
        </div>
      )}

      <ThemeDetailDrawer
        subtema={activeSubtema}
        coverageSubtema={activeCoverageSubtema}
        topic={activeLearningTopic}
        onClose={() => openSubtemaDrawer(null)}
      />
    </div>
  );
}

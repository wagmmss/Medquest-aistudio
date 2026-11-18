import React, { useMemo, useState, useCallback, useDeferredValue } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RotateCcw,
  Play,
  RefreshCw,
  Brain,
  X,
  Search,
  Bookmark,
  Trash2,
  Minus,
  Plus,
  CheckCircle2,
  HeartPulse,
  Scissors,
  Baby,
  Stethoscope,
  ShieldCheck,
} from "lucide-react";
import toast from "react-hot-toast";
import { QuestionMeta } from "@/types/api";
import { api } from "@/lib/api";
import { parseNaturalSessionPrompt } from "@/lib/naturalSessionParser";
import { SavedQuizState } from "../QuizClient";

const SubjectTreeSelector = dynamic(
  () => import("@/components/SubjectTreeSelector").then((mod) => mod.SubjectTreeSelector),
  { ssr: false }
);

const AREA_VISUALS: Array<{
  match: string[];
  label: string;
  badgeClass: string;
  icon: typeof HeartPulse;
}> = [
  {
    match: ["Clínica Médica"],
    label: "Clínica Médica",
    badgeClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
    icon: Stethoscope,
  },
  {
    match: ["Cirurgia Geral", "Cirurgia"],
    label: "Cirurgia Geral",
    badgeClass: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20",
    icon: Scissors,
  },
  {
    match: ["Ginecologia e Obstetrícia"],
    label: "Ginecologia e Obstetrícia",
    badgeClass: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
    icon: HeartPulse,
  },
  {
    match: ["Pediatria"],
    label: "Pediatria",
    badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
    icon: Baby,
  },
  {
    match: ["Medicina Preventiva", "Medicina Preventiva e Social"],
    label: "Medicina Preventiva",
    badgeClass: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20",
    icon: ShieldCheck,
  },
];

interface SubtemaChipProps {
  subtema: string;
  onRemove: (subtema: string) => void;
}

const SubtemaChip = React.memo(function SubtemaChip({ subtema, onRemove }: SubtemaChipProps) {
  return (
    <span className="bg-accent/10 text-accent border border-accent/25 px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5">
      <span className="max-w-[200px] truncate">{subtema}</span>
      <button
        type="button"
        onClick={() => onRemove(subtema)}
        className="hover:text-destructive hover:bg-destructive/10 rounded-full p-0.5 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-destructive focus-visible:outline-none"
        aria-label={`Remover subtema ${subtema}`}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </span>
  );
});

interface SubtemaDropdownItemProps {
  subtema: string;
  count: number;
  onSelect: (subtema: string) => void;
}

const SubtemaDropdownItem = React.memo(function SubtemaDropdownItem({
  subtema,
  count,
  onSelect,
}: SubtemaDropdownItemProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected="false"
      onClick={() => onSelect(subtema)}
      className="w-full text-left flex items-center justify-between px-3.5 py-2.5 hover:bg-elevated text-xs border-b border-line-subtle last:border-0 cursor-pointer focus-visible:bg-elevated focus-visible:outline-none"
    >
      <span className="truncate pr-4 text-ink-primary">{subtema}</span>
      <span className="font-mono-lab tabular-nums text-[11px] font-medium text-ink-muted bg-elevated px-2 py-0.5 rounded-md shrink-0">
        {count}
      </span>
    </button>
  );
});

export interface QuizFiltersProps {
  hasSavedState: boolean;
  savedSessionData: SavedQuizState | null;
  discardSavedQuiz: () => void;
  resumeSavedQuiz: () => void;
  showCustomSession: boolean;
  setShowCustomSession: (val: boolean) => void;
  startRecommendedSession: (kind: "adaptive" | "review" | "wrong", focus?: "coverage" | "balanced" | "retention") => void;
  handleFilterSubmit: (e: React.FormEvent) => void;
  filters: Record<string, string | string[]>;
  setFilters: React.Dispatch<React.SetStateAction<Record<string, string | string[]>>>;
  localLimit: string;
  setLocalLimit: (val: string) => void;
  isUpdatingMeta: boolean;
  dynamicMeta: QuestionMeta;
  subtemaSearch: string;
  setSubtemaSearch: (val: string) => void;
  showTopicTree: boolean;
  setShowTopicTree: React.Dispatch<React.SetStateAction<boolean>>;
  onQuickStartFilters?: (customFilters: Record<string, string | string[]>) => void;
}

export const QuizFilters = React.memo(function QuizFilters({
  hasSavedState,
  savedSessionData,
  discardSavedQuiz,
  resumeSavedQuiz,
  showCustomSession,
  setShowCustomSession,
  startRecommendedSession,
  handleFilterSubmit,
  filters,
  setFilters,
  localLimit,
  setLocalLimit,
  isUpdatingMeta,
  dynamicMeta,
  subtemaSearch,
  setSubtemaSearch,
  showTopicTree,
  setShowTopicTree,
  onQuickStartFilters,
}: QuizFiltersProps) {
  const [adaptiveFocus, setAdaptiveFocus] = useState<"coverage" | "balanced" | "retention">("balanced");
  const queryClient = useQueryClient();
  const [presetName, setPresetName] = useState("");
  const [naturalPrompt, setNaturalPrompt] = useState("");
  const deferredSubtemaSearch = useDeferredValue(subtemaSearch);

  const { data: overviewData } = useQuery({
    queryKey: ["estudar-overview-counts"],
    queryFn: () => api.stats.getOverview(),
    staleTime: 45_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const srsDueCount = overviewData?.srs_due_count ?? 0;
  const totalAttempts = overviewData?.total_attempts ?? 0;

  const { data: presetsData } = useQuery({
    queryKey: ["study-presets"],
    queryFn: () => api.presets.list(),
    enabled: showCustomSession,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const savePresetMutation = useMutation({
    mutationFn: (payload: { name: string; filters: Record<string, string | string[]> }) =>
      api.presets.create(payload.name, payload.filters),
    onSuccess: () => {
      setPresetName("");
      toast.success("Configuração salva nos presets.");
      void queryClient.invalidateQueries({ queryKey: ["study-presets"] });
    },
    onError: () => toast.error("Não foi possível salvar a configuração."),
  });

  const deletePresetMutation = useMutation({
    mutationFn: (id: number) => api.presets.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["study-presets"] });
    },
  });

  const presets = presetsData?.presets ?? [];

  const groupedInstitutions = useMemo(() => {
    const map = new Map<string, { codes: string[]; n: number }>();
    for (const i of dynamicMeta?.institutions || []) {
      let base = i.institution_code.replace(/\s+\d{4}$/, "").replace(/\s+\d$/, "").trim();
      if (base === "FAMEMA SP") base = "FAMEMA";
      if (base === "SCMRP") base = "SCM-RP";
      if (base === "SCM") base = "SCM-SP";

      const existing = map.get(base);
      if (existing) {
        existing.codes.push(i.institution_code);
        existing.n += i.n;
      } else {
        map.set(base, { codes: [i.institution_code], n: i.n });
      }
    }
    return Array.from(map.entries())
      .map(([base, data]) => ({ base, codes: data.codes, n: data.n }))
      .sort((a, b) => b.n - a.n);
  }, [dynamicMeta?.institutions]);

  const targetInstSet = useMemo(() => {
    return new Set((dynamicMeta?.target_institutions || []).map((s) => s.toUpperCase()));
  }, [dynamicMeta?.target_institutions]);

  const selectedInstGroup = useMemo(() => {
    if (!filters.institution) return "";
    let currentArr: string[] = [];
    if (Array.isArray(filters.institution)) {
      currentArr = filters.institution;
    } else if (typeof filters.institution === "string") {
      currentArr = filters.institution.split(",").map((s) => s.trim()).filter(Boolean);
    }
    const single = currentArr[0];
    const group = groupedInstitutions.find((g) => g.codes.includes(single));
    if (group && currentArr.length === 1) return group.base;
    return "";
  }, [filters.institution, groupedInstitutions]);

  const selectedSubtemas = useMemo(() => {
    if (Array.isArray(filters.subtema)) return filters.subtema;
    if (typeof filters.subtema === "string" && filters.subtema.trim().length > 0) return [filters.subtema];
    return [];
  }, [filters.subtema]);

  const selectedSubtemasSet = useMemo(() => new Set(selectedSubtemas), [selectedSubtemas]);

  const filteredSearchSubtemas = useMemo(() => {
    const query = deferredSubtemaSearch.trim().toLowerCase();
    if (!query || !dynamicMeta?.subtemas) return [];
    return dynamicMeta.subtemas
      .filter((s) => !selectedSubtemasSet.has(s.subtema) && s.subtema.toLowerCase().includes(query))
      .slice(0, 50);
  }, [dynamicMeta, deferredSubtemaSearch, selectedSubtemasSet]);

  const handleRemoveSubtema = useCallback(
    (subtemaToRemove: string) => {
      setFilters((prev) => {
        const current = Array.isArray(prev.subtema)
          ? prev.subtema
          : prev.subtema
          ? [prev.subtema as string]
          : [];
        const next = current.filter((x) => x !== subtemaToRemove);
        const updated = { ...prev };
        if (next.length > 0) updated.subtema = next;
        else delete updated.subtema;
        return updated;
      });
    },
    [setFilters]
  );

  const handleClearAllSubtemas = useCallback(() => {
    setFilters((prev) => {
      const updated = { ...prev };
      delete updated.subtema;
      delete updated.area;
      return updated;
    });
  }, [setFilters]);

  const handleAddSubtema = useCallback(
    (subtemaToAdd: string) => {
      setFilters((prev) => {
        const current = Array.isArray(prev.subtema)
          ? [...prev.subtema]
          : prev.subtema
          ? [prev.subtema as string]
          : [];
        if (!current.includes(subtemaToAdd)) current.push(subtemaToAdd);
        return { ...prev, subtema: current };
      });
      setSubtemaSearch("");
    },
    [setFilters, setSubtemaSearch]
  );

  const handleSubtemaInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (filteredSearchSubtemas.length > 0) {
          handleAddSubtema(filteredSearchSubtemas[0].subtema);
        }
      }
    },
    [filteredSearchSubtemas, handleAddSubtema]
  );

  const areaCountsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of dynamicMeta?.areas || []) {
      map.set(a.area, (map.get(a.area) || 0) + a.n);
    }
    return map;
  }, [dynamicMeta?.areas]);

  const stepLimit = (delta: number) => {
    const current = Math.max(1, Math.min(200, Number(localLimit) || 25));
    const next = Math.max(5, Math.min(200, current + delta));
    const str = String(next);
    setLocalLimit(str);
    setFilters((prev) => ({ ...prev, limit: str }));
  };

  const availableSubtemaNames = useMemo(
    () => (dynamicMeta?.subtemas || []).map((s) => s.subtema),
    [dynamicMeta?.subtemas]
  );

  const parsedNaturalSession = useMemo(
    () => parseNaturalSessionPrompt(naturalPrompt, availableSubtemaNames),
    [naturalPrompt, availableSubtemaNames]
  );

  const handleApplyNaturalSession = useCallback(
    (autoStart: boolean) => {
      if (!parsedNaturalSession.isValid) return;
      const nextFilters = { ...parsedNaturalSession.filters };
      if (!nextFilters.limit) {
        nextFilters.limit = localLimit || "20";
      } else if (typeof nextFilters.limit === "string") {
        setLocalLimit(nextFilters.limit);
      }
      setFilters(nextFilters);
      if (autoStart && onQuickStartFilters) {
        onQuickStartFilters(nextFilters);
      } else {
        setShowCustomSession(true);
        toast.success("Filtros preenchidos a partir do comando clínico.");
      }
    },
    [parsedNaturalSession, localLimit, setLocalLimit, setFilters, onQuickStartFilters, setShowCustomSession]
  );

  return (
    <div className="max-w-5xl mx-auto w-full flex flex-col gap-5 pb-6">
      {/* Hero atmosférico limpo */}
      <div className="mq-page-hero p-5 sm:p-6 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-ink-primary tracking-tight">
              Montar Bateria de Questões
            </h1>
            <p className="text-xs sm:text-sm text-ink-secondary mt-1">
              Escolha especialidades, combine filtros ou descreva sua bateria em linguagem natural.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowCustomSession(!showCustomSession)}
            className="text-xs font-semibold text-ink-secondary hover:text-ink-primary bg-surface border border-line-subtle px-3.5 py-2 rounded-xl transition-colors cursor-pointer shrink-0 w-fit"
          >
            {showCustomSession ? "Ver apenas atalhos" : "Expandir filtros"}
          </button>
        </div>

        {/* Construtor de Sessão em Linguagem Natural (Feature B.4) */}
        <div className="bg-surface/90 border border-line-subtle rounded-xl p-3.5 flex flex-col gap-2.5 shadow-2xs">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-accent pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={naturalPrompt}
                onChange={(e) => setNaturalPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && parsedNaturalSession.isValid) {
                    e.preventDefault();
                    handleApplyNaturalSession(true);
                  }
                }}
                placeholder='Comando rápido: ex. "15 questões de GO da UNICAMP que errei" ou "20 de trauma na USP-SP"'
                aria-label="Montar bateria por comando em linguagem natural"
                className="w-full pl-9 pr-8 py-2 bg-canvas border border-line-subtle rounded-lg text-xs sm:text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-accent"
              />
              {naturalPrompt && (
                <button
                  type="button"
                  onClick={() => setNaturalPrompt("")}
                  aria-label="Limpar comando rápido"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink-primary cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {parsedNaturalSession.isValid && (
                <button
                  type="button"
                  onClick={() => handleApplyNaturalSession(false)}
                  className="px-3 py-2 rounded-lg border border-line-subtle bg-canvas hover:bg-elevated text-xs font-semibold text-ink-secondary hover:text-ink-primary transition-colors cursor-pointer"
                >
                  Aplicar filtros
                </button>
              )}
              <button
                type="button"
                disabled={!parsedNaturalSession.isValid}
                onClick={() => handleApplyNaturalSession(true)}
                className="px-3.5 py-2 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-45 text-primary-foreground text-xs font-semibold transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
              >
                <Play size={12} fill="currentColor" />
                Iniciar Bateria
              </button>
            </div>
          </div>

          {parsedNaturalSession.chips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] font-mono-lab text-ink-muted mr-1">
                Filtros reconhecidos:
              </span>
              {parsedNaturalSession.chips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono-lab font-semibold bg-accent/10 text-accent border border-accent/25"
                >
                  {chip.label}
                </span>
              ))}
            </div>
          ) : naturalPrompt.trim().length >= 2 ? (
            <div className="text-[11px] text-ink-muted">
              Nenhum filtro reconhecido ainda — inclua tema (ex.: pneumonia, trauma, apendicite), área (GO, clínica, pediatria) ou banca (USP-SP, UNICAMP, ENARE).
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
              <span className="font-mono-lab">Exemplos:</span>
              {[
                "15 questões de GO da UNICAMP que errei",
                "20 de trauma na USP-SP",
                "10 revisões vencidas de pediatria",
              ].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setNaturalPrompt(sample)}
                  className="px-2 py-0.5 rounded-md bg-canvas hover:bg-elevated border border-line-subtle text-ink-secondary hover:text-ink-primary transition-colors cursor-pointer"
                >
                  “{sample}”
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Retomar sessão salva */}
      {hasSavedState && savedSessionData && (
        <div className="bg-accent/10 border border-accent/30 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center shrink-0">
              <RotateCcw size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink-primary">Sessão em andamento</h3>
              <p className="text-xs text-ink-secondary font-mono-lab tabular-nums">
                Questão {savedSessionData.currentIndex + 1} de {savedSessionData.queue.length}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={discardSavedQuiz}
              className="flex-1 sm:flex-initial px-3 py-2 text-xs font-semibold text-ink-secondary hover:text-destructive hover:bg-destructive/10 rounded-xl transition-colors cursor-pointer"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={resumeSavedQuiz}
              className="flex-1 sm:flex-initial px-4 py-2 text-xs font-semibold bg-primary hover:bg-primary/90 text-white rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Play size={13} fill="currentColor" />
              Continuar sessão
            </button>
          </div>
        </div>
      )}

      {/* Faixa de Atalhos Inteligentes (sem cliques mortos!) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {srsDueCount > 0 ? (
          <button
            type="button"
            onClick={() => startRecommendedSession("review")}
            className="text-left rounded-2xl border border-accent/30 bg-surface hover:border-accent p-4 transition-all cursor-pointer flex flex-col justify-between gap-2 shadow-2xs"
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-accent font-semibold text-xs">
                <RefreshCw size={15} /> Revisão FSRS
              </span>
              <span className="font-mono-lab text-xs font-bold bg-accent/10 text-accent px-2 py-0.5 rounded-full">
                {srsDueCount} vencidas
              </span>
            </div>
            <p className="text-xs text-ink-secondary">Reforce temas no ponto ideal de retenção.</p>
          </button>
        ) : (
          <div className="rounded-2xl border border-line-subtle bg-surface/70 p-4 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-ink-secondary font-semibold text-xs">
                <CheckCircle2 size={15} className="text-normal" /> Revisão FSRS
              </span>
              <span className="text-[11px] font-semibold text-normal bg-normal/10 px-2 py-0.5 rounded-full">
                Em dia
              </span>
            </div>
            <p className="text-xs text-ink-muted">Nenhuma revisão espaçada pendente agora.</p>
          </div>
        )}

        {totalAttempts > 0 ? (
          <button
            type="button"
            onClick={() => startRecommendedSession("wrong")}
            className="text-left rounded-2xl border border-line-subtle bg-surface hover:border-critical/50 p-4 transition-all cursor-pointer flex flex-col justify-between gap-2 shadow-2xs"
          >
            <span className="inline-flex items-center gap-1.5 text-critical font-semibold text-xs">
              <RotateCcw size={15} /> Caderno de Erros
            </span>
            <p className="text-xs text-ink-secondary">Retifique questões erradas recentemente.</p>
          </button>
        ) : (
          <div className="rounded-2xl border border-line-subtle bg-surface/70 p-4 flex flex-col justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-ink-secondary font-semibold text-xs">
              <RotateCcw size={15} className="text-ink-muted" /> Caderno de Erros
            </span>
            <p className="text-xs text-ink-muted">Seus erros futuros aparecerão aqui para revisão.</p>
          </div>
        )}

        <div className="rounded-2xl border border-line-subtle bg-surface p-4 flex flex-col justify-between gap-2.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-ink-primary font-semibold text-xs">
              <Brain size={15} className="text-accent" /> Sessão Adaptativa
            </span>
            <button
              type="button"
              onClick={() => startRecommendedSession("adaptive", adaptiveFocus)}
              className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-white text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1 cursor-pointer"
            >
              <Play size={11} fill="currentColor" /> 30 questões
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1 bg-canvas p-0.5 rounded-lg border border-line-subtle">
            {(
              [
                ["coverage", "Cobertura"],
                ["balanced", "Equilibrado"],
                ["retention", "Fixação"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={adaptiveFocus === key}
                onClick={() => setAdaptiveFocus(key)}
                className={clsx(
                  "py-1.5 px-1 min-h-[32px] text-[11px] font-semibold rounded-md transition-colors cursor-pointer",
                  adaptiveFocus === key ? "bg-accent text-white" : "text-ink-secondary hover:text-ink-primary"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Montador em 2 Colunas estilo Medway */}
      {showCustomSession && (
        <form onSubmit={handleFilterSubmit} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* COLUNA ESQUERDA: 1. Especialidades & Temas */}
            <div className="lg:col-span-7 bg-surface border border-line-subtle rounded-2xl p-5 flex flex-col gap-4 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-ink-primary flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-elevated text-ink-primary text-xs font-bold inline-flex items-center justify-center">
                    1
                  </span>
                  Definir tópicos
                </h2>
                {(selectedSubtemas.length > 0 || filters.area) && (
                  <button
                    type="button"
                    onClick={handleClearAllSubtemas}
                    className="text-xs font-medium text-critical hover:underline cursor-pointer"
                  >
                    Limpar seleções
                  </button>
                )}
              </div>

              <div className="relative">
                <input
                  type="text"
                  placeholder="Buscar especialidades, temas ou focos..."
                  value={subtemaSearch}
                  onChange={(e) => setSubtemaSearch(e.target.value)}
                  onKeyDown={handleSubtemaInputKeyDown}
                  className="w-full bg-canvas border border-line-subtle rounded-xl py-2.5 pl-9 pr-3 text-xs text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  aria-label="Buscar subtema para adicionar"
                />
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />

                {subtemaSearch.trim().length > 0 && (
                  <div
                    role="listbox"
                    aria-label="Sugestões de subtemas"
                    className="absolute z-40 w-full mt-1 bg-surface border border-line-subtle rounded-xl shadow-lg max-h-60 overflow-y-auto"
                  >
                    {filteredSearchSubtemas.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-ink-muted">Nenhum subtema disponível encontrado.</div>
                    ) : (
                      filteredSearchSubtemas.map((s) => (
                        <SubtemaDropdownItem
                          key={s.subtema}
                          subtema={s.subtema}
                          count={s.n}
                          onSelect={handleAddSubtema}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Cards das 5 Grandes Áreas */}
              <div className="flex flex-col gap-2">
                {AREA_VISUALS.map((areaCfg) => {
                  const Icon = areaCfg.icon;
                  const count = areaCfg.match.reduce((acc, m) => acc + (areaCountsMap.get(m) || 0), 0);
                  const isSelected = areaCfg.match.includes(String(filters.area || ""));
                  return (
                    <button
                      key={areaCfg.label}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => {
                        setFilters((prev) => {
                          const next = { ...prev };
                          if (isSelected) delete next.area;
                          else next.area = areaCfg.match.find((m) => areaCountsMap.has(m)) || areaCfg.match[0];
                          return next;
                        });
                      }}
                      className={clsx(
                        "w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border transition-all text-left cursor-pointer",
                        isSelected
                          ? "border-accent bg-accent/5 ring-1 ring-accent/30"
                          : "border-line-subtle bg-canvas/50 hover:bg-elevated/60"
                      )}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <span className={clsx("w-8 h-8 rounded-lg border flex items-center justify-center shrink-0", areaCfg.badgeClass)}>
                          <Icon size={15} />
                        </span>
                        <span className="text-xs font-semibold text-ink-primary truncate">{areaCfg.label}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono-lab tabular-nums text-ink-muted">
                          {count.toLocaleString("pt-BR")}
                        </span>
                        <span
                          className={clsx(
                            "text-[11px] px-2 py-0.5 rounded-full font-medium",
                            isSelected ? "bg-accent text-white" : "bg-surface border border-line-subtle text-ink-muted"
                          )}
                        >
                          {isSelected ? "Selecionada" : "Todas"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedSubtemas.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {selectedSubtemas.map((sub) => (
                    <SubtemaChip key={sub} subtema={sub} onRemove={handleRemoveSubtema} />
                  ))}
                </div>
              )}

              <div className="pt-2 border-t border-line-subtle">
                <button
                  type="button"
                  aria-expanded={showTopicTree}
                  onClick={() => setShowTopicTree((value) => !value)}
                  className="text-xs font-semibold text-accent hover:underline cursor-pointer"
                >
                  {showTopicTree ? "Ocultar árvore detalhada de temas" : "Escolher subtemas na árvore"}
                </button>
                {showTopicTree && (
                  <div className="mt-3">
                    <SubjectTreeSelector
                      selectedSubtemas={selectedSubtemas}
                      onChange={(newSelection) => {
                        const newFilters = { ...filters };
                        if (newSelection.length > 0) newFilters.subtema = newSelection;
                        else delete newFilters.subtema;
                        setFilters(newFilters);
                      }}
                      availableSubtemas={dynamicMeta.subtemas || []}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* COLUNA DIREITA: 2. Configurações */}
            <div className="lg:col-span-5 bg-surface border border-line-subtle rounded-2xl p-5 flex flex-col gap-4 shadow-2xs">
              <h2 className="text-sm font-bold text-ink-primary flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-elevated text-ink-primary text-xs font-bold inline-flex items-center justify-center">
                  2
                </span>
                Configurações
              </h2>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink-primary flex items-center justify-between">
                  <span>Bancas / Instituições</span>
                  {isUpdatingMeta && <span className="text-[11px] text-ink-muted">Atualizando...</span>}
                </label>
                <select
                  className="w-full bg-canvas border border-line-subtle rounded-xl py-2 px-3 text-xs text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  value={selectedInstGroup}
                  onChange={(e) => {
                    const base = e.target.value;
                    if (!base) {
                      const next = { ...filters };
                      delete next.institution;
                      setFilters(next);
                      return;
                    }
                    const grp = groupedInstitutions.find((g) => g.base === base);
                    if (grp) setFilters({ ...filters, institution: grp.codes.join(",") });
                  }}
                >
                  <option value="">Todas as Instituições</option>
                  {groupedInstitutions.map((g) => {
                    const isTarget = g.codes.some((c) => targetInstSet.has(c.toUpperCase()));
                    return (
                      <option key={g.base} value={g.base}>
                        {isTarget ? `${g.base} (${g.n}) — Alvo` : `${g.base} (${g.n})`}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-ink-primary">Ano</label>
                  <select
                    className="w-full bg-canvas border border-line-subtle rounded-xl py-2 px-2.5 text-xs font-mono-lab text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    value={filters.year || ""}
                    onChange={(e) => setFilters({ ...filters, year: e.target.value })}
                  >
                    <option value="">Todos</option>
                    {(dynamicMeta.years || []).map((y) => (
                      <option key={y} value={String(y)}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-ink-primary">Tipo</label>
                  <select
                    className="w-full bg-canvas border border-line-subtle rounded-xl py-2 px-2.5 text-xs text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent"
                    value={typeof filters.question_type === "string" ? filters.question_type : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFilters((prev) => {
                        const next = { ...prev };
                        if (val) next.question_type = val;
                        else delete next.question_type;
                        return next;
                      });
                    }}
                  >
                    <option value="">Todas</option>
                    <option value="objetiva">Objetivas</option>
                    <option value="discursiva">Discursivas</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-semibold text-ink-primary block">Filtros combináveis</span>
                {(() => {
                  const rawStatus =
                    typeof filters.status === "string"
                      ? filters.status
                      : filters.unanswered_only === "true"
                      ? "unanswered"
                      : "";
                  const activeStatuses = new Set(
                    rawStatus
                      .split(",")
                      .map((s) => s.trim())
                      .filter((s) => s && s !== "all")
                  );
                  const toggleStatusToken = (token: string) => {
                    const nextSet = new Set(activeStatuses);
                    if (nextSet.has(token)) nextSet.delete(token);
                    else nextSet.add(token);
                    const nextFilters: Record<string, string | string[]> = { ...filters };
                    const serialized = Array.from(nextSet).join(",");
                    if (serialized) nextFilters.status = serialized;
                    else delete nextFilters.status;
                    if (nextSet.size === 1 && nextSet.has("unanswered")) {
                      nextFilters.unanswered_only = "true";
                    } else {
                      delete nextFilters.unanswered_only;
                    }
                    setFilters(nextFilters);
                  };

                  return (
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { token: "unanswered", label: "Não respondidas" },
                        { token: "wrong", label: "Errei" },
                        { token: "srs_due", label: "Revisão SRS" },
                        { token: "favorite", label: "Favoritas" },
                      ].map((opt) => {
                        const active = activeStatuses.has(opt.token);
                        return (
                          <button
                            key={opt.token}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleStatusToken(opt.token)}
                            className={clsx(
                              "px-3 py-1.5 min-h-[32px] rounded-full border text-[11px] font-medium transition-colors cursor-pointer",
                              active
                                ? "bg-accent/15 border-accent text-accent font-semibold"
                                : "bg-canvas border-line-subtle text-ink-secondary hover:text-ink-primary"
                            )}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        aria-pressed={filters.has_images === "1"}
                        onClick={() =>
                          setFilters((prev) => {
                            const next = { ...prev };
                            if (next.has_images === "1") delete next.has_images;
                            else next.has_images = "1";
                            return next;
                          })
                        }
                        className={clsx(
                          "px-3 py-1.5 min-h-[32px] rounded-full border text-[11px] font-medium transition-colors cursor-pointer",
                          filters.has_images === "1"
                            ? "bg-accent/15 border-accent text-accent font-semibold"
                            : "bg-canvas border-line-subtle text-ink-secondary hover:text-ink-primary"
                        )}
                      >
                        Com imagens
                      </button>
                      <button
                        type="button"
                        aria-pressed={filters.exclude_annulled === "1"}
                        onClick={() =>
                          setFilters((prev) => {
                            const next = { ...prev };
                            if (next.exclude_annulled === "1") delete next.exclude_annulled;
                            else next.exclude_annulled = "1";
                            return next;
                          })
                        }
                        className={clsx(
                          "px-3 py-1.5 min-h-[32px] rounded-full border text-[11px] font-medium transition-colors cursor-pointer",
                          filters.exclude_annulled === "1"
                            ? "bg-accent/15 border-accent text-accent font-semibold"
                            : "bg-canvas border-line-subtle text-ink-secondary hover:text-ink-primary"
                        )}
                      >
                        Ocultar anuladas
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* Presets Salvos */}
              <div className="pt-3 border-t border-line-subtle flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-primary flex items-center gap-1.5">
                    <Bookmark size={13} className="text-accent" /> Presets salvos ({presets.length})
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    aria-label="Nome da configuração de preset"
                    placeholder="Nome da configuração..."
                    className="flex-1 bg-canvas border border-line-subtle rounded-xl px-3 py-1.5 text-xs text-ink-primary focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    type="button"
                    disabled={!presetName.trim() || savePresetMutation.isPending}
                    onClick={() => savePresetMutation.mutate({ name: presetName.trim(), filters })}
                    className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-primary hover:text-white border border-line-subtle text-xs font-semibold text-ink-primary disabled:opacity-40 transition-colors cursor-pointer shrink-0"
                  >
                    Salvar
                  </button>
                </div>
                {presets.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {presets.map((p) => (
                      <div
                        key={p.id}
                        className="inline-flex items-center gap-1 bg-canvas border border-line-subtle rounded-lg px-2 py-1 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setFilters(p.filters);
                            if (typeof p.filters.limit === "string") setLocalLimit(p.filters.limit);
                            toast.success(`Preset "${p.name}" aplicado.`);
                          }}
                          className="font-medium text-ink-primary hover:text-accent cursor-pointer"
                        >
                          {p.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePresetMutation.mutate(p.id)}
                          aria-label={`Remover preset ${p.name}`}
                          className="text-ink-muted hover:text-destructive cursor-pointer p-0.5"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Rodapé Sticky com Contagem Viva + Stepper [- 25 +] */}
          <div className="sticky bottom-2 z-20 bg-surface/95 backdrop-blur-md border border-line-subtle rounded-2xl p-3.5 shadow-md flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs text-ink-secondary">
              <span className="font-mono-lab font-bold text-lg text-ink-primary tabular-nums">
                {isUpdatingMeta ? "..." : (dynamicMeta?.total_questions ?? 0).toLocaleString("pt-BR")}
              </span>
              <span>questões disponíveis</span>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              <div className="flex items-center gap-1 bg-canvas border border-line-subtle rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => stepLimit(-5)}
                  aria-label="Diminuir quantidade"
                  className="p-1.5 min-w-[38px] min-h-[38px] flex items-center justify-center rounded-lg hover:bg-elevated text-ink-secondary cursor-pointer"
                >
                  <Minus size={14} />
                </button>
                <input
                  type="number"
                  min="1"
                  max="200"
                  aria-label="Quantidade de questões"
                  className="w-12 text-center bg-transparent text-xs font-mono-lab font-bold text-ink-primary focus:outline-none tabular-nums"
                  value={localLimit}
                  onChange={(e) => {
                    const val = e.target.value;
                    setLocalLimit(val);
                    setFilters((prev) => ({ ...prev, limit: val }));
                  }}
                />
                <button
                  type="button"
                  onClick={() => stepLimit(5)}
                  aria-label="Aumentar quantidade"
                  className="p-1.5 min-w-[38px] min-h-[38px] flex items-center justify-center rounded-lg hover:bg-elevated text-ink-secondary cursor-pointer"
                >
                  <Plus size={14} />
                </button>
              </div>

              <button
                type="submit"
                className="bg-primary hover:bg-primary/90 text-white font-semibold px-5 py-2.5 min-h-[38px] rounded-xl transition-colors flex items-center justify-center gap-2 shadow-xs text-xs cursor-pointer"
              >
                <Play size={14} fill="currentColor" />
                Iniciar bateria
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
});

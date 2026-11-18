"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search, X, Sparkles, Filter, Image as ImageIcon,
  ExternalLink, PlayCircle, BookOpen, AlertCircle, RefreshCw, Lightbulb
} from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { QuestionMeta, SearchResult, SearchFilterOptions } from "@/types/api";
import { parseSearchHighlight } from "@/lib/searchHighlight";
import { useQuestionMetaQuery } from "@/lib/queries/useStudyQueries";

const QUICK_TOPICS = [
  "IAM com supra",
  "Choque Séptico",
  "Cetoacidose",
  "Apendicite",
  "Pré-eclâmpsia",
  "Tromboembolismo",
  "Dengue",
  "Meningite",
  "Asma aguda",
];

const FALLBACK_AREAS = [
  "Clínica Médica",
  "Cirurgia",
  "Pediatria",
  "Ginecologia e Obstetrícia",
  "Medicina Preventiva",
];

function getAreaBadgeColor(area: string) {
  if (area.includes("Clínica")) return "bg-accent/10 text-accent border-accent/25";
  if (area.includes("Cirurgia")) return "bg-normal-bg text-normal border-normal/25";
  if (area.includes("Pediatria")) return "bg-warning/10 text-warning border-warning/25";
  if (area.includes("Ginecologia")) return "bg-critical-bg text-critical border-critical/25";
  if (area.includes("Preventiva")) return "bg-elevated text-ink-primary border-line-subtle";
  return "bg-elevated text-ink-secondary border-line-subtle";
}

function HighlightedSnippet({ text }: { text: string }) {
  const segments = parseSearchHighlight(text);
  return (
    <>
      {segments.map((seg, idx) =>
        seg.highlight ? (
          <mark
            key={idx}
            className="bg-accent/15 text-accent font-semibold rounded-xs px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={idx}>{seg.text}</span>
        )
      )}
    </>
  );
}

interface SearchClientProps {
  initialQuery?: string;
  initialArea?: string;
  initialInstitution?: string;
  initialYear?: string;
  initialWithImage?: boolean;
  initialMeta?: QuestionMeta | null;
}

export function SearchClient({
  initialQuery = "",
  initialArea = "Todas",
  initialInstitution = "Todas",
  initialYear = "Todos",
  initialWithImage = false,
  initialMeta = null,
}: SearchClientProps) {
  const router = useRouter();
  const { data: queriedMeta } = useQuestionMetaQuery(
    {},
    !initialMeta,
    initialMeta ?? undefined
  );
  const meta = initialMeta ?? (queriedMeta?.total_questions ? queriedMeta : null);
  const [query, setQuery] = useState(initialQuery);
  const [selectedArea, setSelectedArea] = useState(initialArea);
  const [selectedInstitution, setSelectedInstitution] = useState(initialInstitution);
  const [selectedYear, setSelectedYear] = useState<string>(initialYear);
  const [onlyWithImage, setOnlyWithImage] = useState(initialWithImage);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const areaOptions = useMemo(() => {
    const rawAreas = meta?.areas?.map((a) => a.area).filter(Boolean) || FALLBACK_AREAS;
    const unique = Array.from(new Set(rawAreas));
    return ["Todas", ...unique];
  }, [meta]);

  const institutionOptions = useMemo(() => {
    const rawInsts = meta?.institutions?.map((i) => ({
      code: i.institution_code,
      label: i.institution_label || i.institution_code,
    })) || [];
    if (rawInsts.length === 0) {
      return [{ code: "Todas", label: "Todas" }];
    }
    return [{ code: "Todas", label: "Todas" }, ...rawInsts];
  }, [meta]);

  const yearOptions = useMemo(() => {
    const rawYears = meta?.years?.slice().sort((a, b) => b - a).map(String) || [];
    return ["Todos", ...rawYears];
  }, [meta]);

  // Atalho de teclado: '/' foca no campo de busca
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (
        e.key === "/" &&
        active !== inputRef.current &&
        !(
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement ||
          active?.isContentEditable
        ) &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const executeSearch = useCallback(
    async (q: string, area: string, inst: string, year: string, withImg: boolean) => {
      const cleanQ = q.trim();
      const hasFilters = area !== "Todas" || inst !== "Todas" || year !== "Todos" || withImg;

      if (!cleanQ && !hasFilters) {
        setResults([]);
        setIsLoading(false);
        setHasSearched(false);
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError(null);

      const filterOpts: SearchFilterOptions = {
        limit: 50,
        area: area !== "Todas" ? area : undefined,
        institution: inst !== "Todas" ? inst : undefined,
        year: year !== "Todos" ? year : undefined,
        has_images: withImg ? true : undefined,
      };

      try {
        const data = await api.questions.search(cleanQ, filterOpts, controller.signal);
        setResults(data);
        setHasSearched(true);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        console.error("Falha ao buscar questões:", err);
        setError("Não foi possível carregar os resultados da busca. Tente novamente.");
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Debounced search trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      void executeSearch(query, selectedArea, selectedInstitution, selectedYear, onlyWithImage);
    }, 280);

    return () => clearTimeout(timer);
  }, [query, selectedArea, selectedInstitution, selectedYear, onlyWithImage, executeSearch]);

  const handleClear = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  const handleStartPracticeBatch = () => {
    if (results.length === 0) return;
    const params = new URLSearchParams();
    const cleanQ = query.trim();
    if (cleanQ) params.set("q", cleanQ);
    if (selectedArea !== "Todas") params.set("area", selectedArea);
    if (selectedInstitution !== "Todas") params.set("institution", selectedInstitution);
    if (selectedYear !== "Todos") params.set("year", selectedYear);
    if (onlyWithImage) params.set("has_images", "true");

    if (!cleanQ && selectedArea === "Todas" && selectedInstitution === "Todas" && selectedYear === "Todos" && !onlyWithImage) {
      const targetSubtema = results[0]?.subtema;
      if (targetSubtema) params.set("subtema", targetSubtema);
    }

    params.set("limit", "20");
    router.push(`/estudar?${params.toString()}`);
  };

  const totalCountLabel =
    meta?.total_questions && meta.total_questions > 0
      ? `${meta.total_questions.toLocaleString("pt-BR")} questões`
      : "acervo completo de questões";

  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto px-4 sm:px-6 py-5 pb-24">
      {/* Top Header */}
      <div className="mq-page-hero p-5 sm:p-6 shadow-2xs flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-accent font-semibold text-xs">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Pesquisa Clínica em {totalCountLabel}</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink-primary tracking-tight">
          Busca Clínica Instantânea
        </h1>
        <p className="text-xs sm:text-sm text-ink-secondary">
          Pesquise por síndromes, sinais semiológicos, condutas de emergência, achados de imagem ou bancas examinadoras.
        </p>
      </div>

      {/* Main Search Bar */}
      <div className="relative flex items-center w-full">
        <div className="absolute left-3.5 text-ink-muted pointer-events-none flex items-center justify-center">
          <Search className="w-4.5 h-4.5" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Pesquisar questões por síndromes, condutas ou bancas"
          placeholder="Ex: infarto com supra, cetoacidose, sinal de Cullen, apendicite, pré-eclâmpsia..."
          className="w-full h-12 pl-10 pr-20 rounded-2xl bg-surface border border-line-subtle text-ink-primary placeholder:text-ink-muted text-sm shadow-2xs focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
        />
        <div className="absolute right-3 flex items-center gap-1.5">
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1.5 rounded-md text-ink-muted hover:text-ink-primary hover:bg-elevated transition-colors cursor-pointer"
              title="Limpar busca"
              aria-label="Limpar busca"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <span className="hidden sm:inline-flex items-center justify-center px-2 py-0.5 text-[11px] font-mono-lab text-ink-muted bg-elevated rounded-xs border border-line-subtle">
            /
          </span>
        </div>
      </div>

      {/* Quick Clinical Suggestions */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <span className="font-mono-lab text-[11px] font-semibold uppercase tracking-wider text-ink-muted mr-1">
          Sugestões:
        </span>
        {QUICK_TOPICS.map((topic) => (
          <button
            key={topic}
            type="button"
            onClick={() => setQuery(topic)}
            className="text-xs font-medium px-2.5 py-1 rounded-md bg-surface hover:bg-accent/10 hover:text-accent hover:border-accent/30 border border-line-subtle text-ink-primary transition-colors cursor-pointer"
          >
            {topic}
          </button>
        ))}
      </div>

      {/* Structured Filters */}
      <div className="flex flex-wrap items-center gap-3 p-3.5 rounded-lg bg-surface border border-line-subtle shadow-2xs">
        <div className="flex items-center gap-1.5 font-mono-lab text-[11px] font-bold text-ink-muted uppercase tracking-wider mr-1">
          <Filter className="w-3.5 h-3.5" />
          <span>Filtros:</span>
        </div>

        {/* Área Filter */}
        <div className="flex items-center gap-1.5 text-xs">
          <label htmlFor="area-filter" className="text-ink-secondary font-medium">Área:</label>
          <select
            id="area-filter"
            value={selectedArea}
            onChange={(e) => setSelectedArea(e.target.value)}
            className="h-9 px-2.5 rounded-md bg-canvas border border-line-subtle text-ink-primary font-medium text-xs focus:ring-1 focus:ring-accent cursor-pointer"
          >
            {areaOptions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {/* Banca Filter */}
        <div className="flex items-center gap-1.5 text-xs">
          <label htmlFor="institution-filter" className="text-ink-secondary font-medium">Banca:</label>
          <select
            id="institution-filter"
            value={selectedInstitution}
            onChange={(e) => setSelectedInstitution(e.target.value)}
            className="h-9 px-2.5 rounded-md bg-canvas border border-line-subtle text-ink-primary font-medium text-xs focus:ring-1 focus:ring-accent cursor-pointer"
          >
            {institutionOptions.map((inst) => (
              <option key={inst.code} value={inst.code}>{inst.label}</option>
            ))}
          </select>
        </div>

        {/* Ano Filter */}
        <div className="flex items-center gap-1.5 text-xs">
          <label htmlFor="year-filter" className="text-ink-secondary font-medium">Ano:</label>
          <select
            id="year-filter"
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="h-9 px-2.5 rounded-md bg-canvas border border-line-subtle text-ink-primary font-mono-lab font-medium text-xs focus:ring-1 focus:ring-accent cursor-pointer"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Imagem Toggle */}
        <button
          type="button"
          onClick={() => setOnlyWithImage(!onlyWithImage)}
          aria-pressed={onlyWithImage}
          className={clsx(
            "flex items-center gap-1.5 min-h-[38px] px-3 rounded-md text-xs font-medium border transition-colors cursor-pointer ml-auto sm:ml-0",
            onlyWithImage
              ? "bg-accent text-white border-accent shadow-2xs"
              : "bg-canvas text-ink-secondary border-line-subtle hover:bg-elevated hover:text-ink-primary"
          )}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Com Imagem</span>
        </button>
      </div>

      {/* Results Header */}
      {hasSearched && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-b border-line-subtle pb-3">
          <div className="flex items-center gap-2">
            <span className="font-mono-lab tabular-nums text-xs sm:text-sm font-bold text-ink-primary">
              {results.length} {results.length === 1 ? "questão encontrada" : "questões encontradas"}
            </span>
            {isLoading && (
              <div className="flex items-center gap-1 text-xs text-ink-secondary">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Atualizando...</span>
              </div>
            )}
          </div>

          {results.length > 0 && (
            <button
              type="button"
              onClick={handleStartPracticeBatch}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-accent text-white font-semibold text-xs shadow-2xs hover:bg-accent/90 transition-colors cursor-pointer"
            >
              <PlayCircle className="w-4 h-4" />
              <span>Resolver no Estudar</span>
            </button>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-xs sm:text-sm font-medium">{error}</span>
        </div>
      )}

      {/* Initial state (No search executed) */}
      {!hasSearched && !isLoading && (
        <div className="flex flex-col items-center justify-center p-10 text-center rounded-lg border border-dashed border-line-subtle bg-elevated/30">
          <div className="w-11 h-11 rounded-md bg-accent/10 border border-accent/20 text-accent flex items-center justify-center mb-3">
            <Search className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-ink-primary mb-1">
            Explore {totalCountLabel} comentadas
          </h3>
          <p className="text-xs sm:text-sm text-ink-secondary max-w-md">
            Digite um quadro clínico, droga ou conceito das bancas examinadoras ou combine os filtros acima para pesquisar instantaneamente.
          </p>
        </div>
      )}

      {/* Loading state skeleton */}
      {isLoading && results.length === 0 && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-5 rounded-lg bg-surface border border-line-subtle space-y-3">
              <div className="flex gap-2">
                <div className="h-5 w-20 bg-elevated rounded-xs" />
                <div className="h-5 w-16 bg-elevated rounded-xs" />
                <div className="h-5 w-32 bg-elevated rounded-xs" />
              </div>
              <div className="h-4 w-full bg-elevated rounded-xs" />
              <div className="h-4 w-3/4 bg-elevated rounded-xs" />
            </div>
          ))}
        </div>
      )}

      {/* No results found */}
      {hasSearched && !isLoading && results.length === 0 && (
        <div className="flex flex-col items-center justify-center p-10 text-center rounded-lg border border-line-subtle bg-surface">
          <div className="w-11 h-11 rounded-md bg-elevated text-ink-muted flex items-center justify-center mb-3">
            <BookOpen className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-ink-primary mb-1">
            Nenhuma questão encontrada
          </h3>
          <p className="text-xs sm:text-sm text-ink-secondary max-w-md">
            Não encontramos questões correspondentes aos termos e filtros selecionados. Tente termos mais abrangentes ou remova alguns filtros.
          </p>
        </div>
      )}

      {/* Results List */}
      {results.length > 0 && (
        <div className="flex flex-col gap-3">
          {results.map((q) => (
            <div
              key={q.id}
              className="p-4 sm:p-5 rounded-lg bg-surface border border-line-subtle hover:border-accent/40 transition-colors shadow-2xs group flex flex-col gap-2.5"
            >
              {/* Card Header */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <span className="px-2 py-0.5 rounded-xs bg-elevated border border-line-subtle text-ink-primary font-mono-lab font-bold text-xs tabular-nums">
                    {q.institution_code} {q.year}
                  </span>

                  <span className={clsx("px-2 py-0.5 rounded-xs border text-xs font-semibold", getAreaBadgeColor(q.area))}>
                    {q.area}
                  </span>

                  {q.subtema && (
                    <span className="px-2 py-0.5 rounded-xs bg-elevated/60 text-ink-secondary text-xs font-medium truncate max-w-[220px]">
                      {q.subtema}
                    </span>
                  )}

                  {q.has_image && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-accent/10 text-accent border border-accent/20 text-[11px] font-semibold">
                      <ImageIcon className="w-3 h-3" />
                      <span>Imagem</span>
                    </span>
                  )}

                  {q.is_autoral && (
                    <span className="px-1.5 py-0.5 rounded-xs bg-normal-bg text-normal border border-normal/25 font-mono-lab text-[10px] font-bold uppercase">
                      Autoral
                    </span>
                  )}
                </div>

                <Link
                  href={`/estudar?id=${q.id}`}
                  className="flex items-center gap-1 text-xs font-semibold text-accent group-hover:underline cursor-pointer"
                >
                  <span>Resolver questão</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              {/* Stem Snippet (Safe React highlight parser — zero dangerouslySetInnerHTML) */}
              <div className="text-sm text-ink-primary leading-relaxed line-clamp-3">
                <HighlightedSnippet text={q.stem_snippet} />
              </div>

              {/* Explanation Snippet (if available) */}
              {q.exp_snippet && (
                <div className="p-2.5 rounded-md bg-elevated/40 border border-line-subtle text-xs text-ink-secondary flex items-start gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <span className="font-semibold text-ink-primary mr-1">Comentário:</span>
                    <HighlightedSnippet text={q.exp_snippet} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

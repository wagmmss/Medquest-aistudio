"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Crosshair, CheckCircle2, ArrowRight, Flame, Search } from "lucide-react";
import { api } from "@/lib/api";
import { FocusPrevalence } from "@/types/api";
import { normalizeTopicSearch } from "@/lib/analysisTimeline";

const PREVALENCE_OPTIONS: Array<{ value: "all" | FocusPrevalence; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "prioritario", label: "Prioritário (Top 25%)" },
  { value: "alta", label: "Alta incidência" },
  { value: "media", label: "Média incidência" },
];

export function FocusRadarTab({
  institutionOptions,
  selectedInstitution,
  onInspectSubtema,
}: {
  institutionOptions: { key: string; label: string }[];
  selectedInstitution: string;
  onInspectSubtema?: (subtema: string) => void;
}) {
  const [prevalence, setPrevalence] = useState<"all" | FocusPrevalence>("prioritario");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["focus-radar", selectedInstitution, prevalence],
    queryFn: () => api.stats.getFocusRadar(selectedInstitution || undefined, prevalence),
    staleTime: 60_000,
  });

  const summary = data?.summary;
  const areas = data?.areas ?? [];
  const normalizedSearch = useMemo(
    () => normalizeTopicSearch(searchQuery.trim()),
    [searchQuery]
  );
  const focuses = useMemo(() => {
    const raw = data?.focuses ?? [];
    if (!normalizedSearch) return raw;
    return raw.filter(
      (f) =>
        normalizeTopicSearch(f.subtema).includes(normalizedSearch) ||
        normalizeTopicSearch(f.area).includes(normalizedSearch)
    );
  }, [data?.focuses, normalizedSearch]);

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-surface border border-line-subtle rounded-md p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-mono-lab uppercase tracking-wider text-accent font-semibold">
            Raio-X Sniper da Banca
          </span>
          <h2 className="text-base font-bold text-ink-primary flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-accent" />
            Domínio de Focos por Prevalência
          </h2>
          <p className="text-xs text-ink-secondary">
            Cruza os subtemas que mais caem na sua banca-alvo com seu desempenho real (domínio: ≥3 tentativas e ≥75% acerto).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1.5 text-xs font-mono-lab bg-canvas border border-line-subtle rounded-xs text-ink-secondary">
            Banca: <strong className="text-ink-primary">{institutionOptions.find((o) => o.key === selectedInstitution)?.label || selectedInstitution || "Todas"}</strong>
          </span>

          <select
            value={prevalence}
            onChange={(e) => setPrevalence(e.target.value as "all" | FocusPrevalence)}
            aria-label="Filtrar por prevalência"
            className="px-3 py-2 text-xs bg-canvas border border-line-subtle rounded-xs text-ink-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {PREVALENCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {data?.sniper_url && (
            <Link
              href={data.sniper_url}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xs bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors"
            >
              <Flame className="w-3.5 h-3.5" />
              Gerar Bateria Sniper
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-xs text-ink-secondary">
          Calculando prevalência de focos...
        </div>
      ) : isError ? (
        <div className="p-4 rounded-xs border border-destructive/30 bg-destructive/5 text-xs text-destructive">
          Não foi possível carregar o Raio-X Sniper agora.
        </div>
      ) : (
        <>
          {summary && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-surface border border-line-subtle rounded-sm p-3.5">
                  <span className="text-[11px] font-mono-lab uppercase text-ink-muted">Focos Prioritários</span>
                  <p className="text-xl font-bold text-ink-primary mt-1 tabular-nums">
                    {summary.priority_mastered} / {summary.priority_total}
                  </p>
                  <span className="text-[11px] text-ink-secondary">dominados na banca</span>
                </div>
                <div className="bg-surface border border-line-subtle rounded-sm p-3.5">
                  <span className="text-[11px] font-mono-lab uppercase text-ink-muted">Domínio Total</span>
                  <p className="text-xl font-bold text-ink-primary mt-1 tabular-nums">
                    {summary.mastered_focuses} / {summary.total_focuses}
                  </p>
                  <span className="text-[11px] text-ink-secondary">focos mapeados</span>
                </div>
              </div>
              {areas.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {areas.map((a) => (
                    <div key={a.area} className="bg-surface border border-line-subtle rounded-sm p-3">
                      <span className="text-[11px] font-mono-lab uppercase text-ink-muted truncate block">{a.area}</span>
                      <p className="text-lg font-bold text-ink-primary mt-1 tabular-nums">
                        {a.mastered_count} / {a.focuses_count}
                      </p>
                      <span className="text-[11px] text-ink-secondary">
                        {a.accuracy !== null ? `${Math.round(a.accuracy * 100)}% acerto` : `${a.available} questões`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="bg-surface border border-line-subtle rounded-md overflow-hidden">
            <div className="px-4 py-3 border-b border-line-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider font-mono-lab text-ink-primary">
                Focos Ranqueados por Incidência ({focuses.length})
              </h3>
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-ink-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrar subtema ou área..."
                  aria-label="Filtrar focos por subtema ou área"
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-canvas border border-line-subtle rounded-xs text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
            <div className="divide-y divide-line-subtle max-h-[520px] overflow-y-auto">
              {focuses.map((f) => (
                <div
                  key={`${f.area}-${f.subtema}`}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-elevated/40 transition-colors"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded-xs text-[10px] font-mono-lab uppercase font-bold ${
                          f.prevalence === "prioritario"
                            ? "bg-critical/15 text-critical border border-critical/30"
                            : f.prevalence === "alta"
                            ? "bg-warning/15 text-warning border border-warning/30"
                            : "bg-elevated text-ink-muted border border-line-subtle"
                        }`}
                      >
                        {f.prevalence}
                      </span>
                      {onInspectSubtema ? (
                        <button
                          type="button"
                          onClick={() => onInspectSubtema(f.subtema)}
                          className="text-xs font-semibold text-ink-primary hover:text-accent hover:underline truncate text-left cursor-pointer"
                        >
                          {f.subtema}
                        </button>
                      ) : (
                        <span className="text-xs font-semibold text-ink-primary truncate">{f.subtema}</span>
                      )}
                      {f.mastered && <CheckCircle2 className="w-3.5 h-3.5 text-normal shrink-0" />}
                    </div>
                    <span className="text-[11px] text-ink-muted">
                      {f.area} &bull; {f.available} questões na banca &bull;{" "}
                      {f.attempts > 0
                        ? `${f.attempts} tent. (${Math.round((f.accuracy ?? 0) * 100)}% acerto)`
                        : "Ainda não praticado"}
                    </span>
                  </div>

                  <Link
                    href={
                      f.sniper_url.includes("limit=")
                        ? f.sniper_url.replace(/limit=\d+/, "limit=10")
                        : `${f.sniper_url}${f.sniper_url.includes("?") ? "&" : "?"}limit=10`
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xs border border-line-subtle bg-canvas hover:border-accent hover:text-accent text-[11px] font-semibold text-ink-primary transition-colors shrink-0 w-fit"
                  >
                    Treinar (10q) <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

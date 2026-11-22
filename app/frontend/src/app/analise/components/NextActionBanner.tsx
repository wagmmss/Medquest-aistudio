"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Brain, Crosshair, Flame, ShieldCheck, Target } from "lucide-react";
import { api } from "@/lib/api";
import type { AtRiskTopic, ExamReadiness, WeakTopic } from "@/types/api";

interface NextActionBannerProps {
  selectedInstitution: string;
  institutionLabel: string;
  examReadiness?: ExamReadiness;
  atRiskTopic?: AtRiskTopic;
  weakTopic?: WeakTopic;
  questionsToday?: number;
  onOpenTab: (tab: "prontidao" | "sniper" | "cobertura") => void;
}

export function NextActionBanner({
  selectedInstitution,
  institutionLabel,
  examReadiness,
  atRiskTopic,
  weakTopic,
  questionsToday,
  onOpenTab,
}: NextActionBannerProps) {
  const { data: focusData } = useQuery({
    queryKey: ["focus-radar", selectedInstitution, "prioritario"],
    queryFn: () => api.stats.getFocusRadar(selectedInstitution || undefined, "prioritario"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const topFocus =
    focusData?.focuses?.find((f) => !f.mastered) ?? focusData?.focuses?.[0];

  const readinessScorePct =
    examReadiness?.evidence_status !== "insufficient" &&
    examReadiness?.readiness_score !== undefined
      ? `${Math.round(examReadiness.readiness_score * 100)}%`
      : null;

  const hasAnyAction = Boolean(atRiskTopic || weakTopic || topFocus);
  if (!hasAnyAction && !readinessScorePct) {
    return null;
  }

  return (
    <section
      aria-label="Resumo de próxima ação recomendada"
      className="bg-surface border border-line-subtle rounded-2xl p-4 md:p-5 flex flex-col gap-4 shadow-2xs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line-subtle pb-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-mono-lab uppercase tracking-wider text-accent font-semibold">
            Plano de Ataque Hoje · {institutionLabel}
          </span>
          <h2 className="text-sm md:text-base font-bold text-ink-primary">
            Onde você ganha mais pontos agora
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenTab("prontidao")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-canvas border border-line-subtle hover:border-primary/40 text-xs font-mono-lab text-ink-secondary hover:text-ink-primary transition-colors cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            <span>Prontidão:</span>
            <strong className="text-ink-primary tabular-nums">
              {readinessScorePct ?? "Em calibração"}
            </strong>
          </button>

          {focusData?.sniper_url && (
            <Link
              href={focusData.sniper_url}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors"
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Bateria Sniper</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}

          {questionsToday && questionsToday > 0 && (
            <Link
              href={`/estudar?mode=adaptive&limit=${questionsToday}${
                selectedInstitution
                  ? `&institution=${encodeURIComponent(selectedInstitution)}`
                  : ""
              }`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              <span>Sessão adaptativa ({questionsToday}q)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-canvas border border-line-subtle rounded-xl p-3.5 flex flex-col justify-between gap-2.5">
          <div className="flex items-start justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-mono-lab uppercase font-semibold text-warning">
              <Brain className="w-3.5 h-3.5" /> Revisão FSRS
            </span>
            {atRiskTopic && (
              <span className="text-[11px] font-mono-lab tabular-nums text-warning font-semibold">
                {atRiskTopic.items_count} em risco
              </span>
            )}
          </div>
          {atRiskTopic ? (
            <>
              <p className="text-xs font-semibold text-ink-primary line-clamp-2" title={atRiskTopic.subtema}>
                {atRiskTopic.subtema}
              </p>
              <Link
                href={`/estudar?subtema=${encodeURIComponent(atRiskTopic.subtema)}&status=srs_due&limit=20`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline w-fit"
              >
                Revisar agora <ArrowRight className="w-3 h-3" />
              </Link>
            </>
          ) : (
            <p className="text-xs text-ink-muted">
              Sem revisões críticas vencidas no momento.
            </p>
          )}
        </div>

        <div className="bg-canvas border border-line-subtle rounded-xl p-3.5 flex flex-col justify-between gap-2.5">
          <div className="flex items-start justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-mono-lab uppercase font-semibold text-destructive">
              <Target className="w-3.5 h-3.5" /> Maior Gargalo
            </span>
            {weakTopic && (
              <span className="text-[11px] font-mono-lab tabular-nums text-destructive font-semibold">
                {Math.round((weakTopic.accuracy || 0) * 100)}% ({weakTopic.attempts}q)
              </span>
            )}
          </div>
          {weakTopic ? (
            <>
              <p className="text-xs font-semibold text-ink-primary line-clamp-2" title={weakTopic.topic}>
                {weakTopic.topic}
              </p>
              <Link
                href={`/estudar?subtema=${encodeURIComponent(weakTopic.topic)}&status=all&limit=10`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline w-fit"
              >
                Corrigir (10q) <ArrowRight className="w-3 h-3" />
              </Link>
            </>
          ) : (
            <p className="text-xs text-ink-muted">
              Continue respondendo para mapear seus pontos fracos.
            </p>
          )}
        </div>

        <div className="bg-canvas border border-line-subtle rounded-xl p-3.5 flex flex-col justify-between gap-2.5">
          <div className="flex items-start justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-mono-lab uppercase font-semibold text-primary">
              <Crosshair className="w-3.5 h-3.5" /> Prioridade da Banca
            </span>
            {topFocus && (
              <span className="text-[11px] font-mono-lab tabular-nums text-ink-muted">
                {topFocus.available}q
              </span>
            )}
          </div>
          {topFocus ? (
            <>
              <p className="text-xs font-semibold text-ink-primary line-clamp-2" title={topFocus.subtema}>
                {topFocus.subtema}
              </p>
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={
                    topFocus.sniper_url.includes("limit=")
                      ? topFocus.sniper_url.replace(/limit=\d+/, "limit=10")
                      : `${topFocus.sniper_url}${topFocus.sniper_url.includes("?") ? "&" : "?"}limit=10`
                  }
                  className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                >
                  Treinar (10q) <ArrowRight className="w-3 h-3" />
                </Link>
                <button
                  type="button"
                  onClick={() => onOpenTab("sniper")}
                  className="text-[11px] font-semibold text-ink-secondary hover:text-ink-primary cursor-pointer"
                >
                  Ver todos →
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-ink-muted">
              Carregando focos de alta incidência da banca...
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import clsx from "clsx";
import type { ExamReadiness } from "@/types/api";

interface ReadinessEditalTabProps {
  examReadiness: ExamReadiness;
  institutionOptions: { key: string; label: string }[];
  selectedInstitution: string;
  loadingReadiness: boolean;
  readinessError: string | null;
  onRetryReadiness: () => void;
}

export function ReadinessEditalTab({
  examReadiness,
  institutionOptions,
  selectedInstitution,
  loadingReadiness,
  readinessError,
  onRetryReadiness,
}: ReadinessEditalTabProps) {
  const hasSufficientReadinessEvidence =
    examReadiness.evidence_status !== "insufficient";

  return (
    <section className="bg-surface border border-line-subtle rounded-lg p-6 md:p-7 flex flex-col gap-6 pb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-line-subtle pb-5">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground">
            Prontidão Estimada por Edital
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            Modelo estatístico bayesiano (Beta-Binomial) ponderado pela distribuição
            curricular do edital.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-canvas border border-line-subtle text-xs font-mono-lab text-foreground shrink-0">
          <span className="text-muted-foreground">Banca ativa:</span>
          <span className="font-bold">
            {institutionOptions.find((o) => o.key === selectedInstitution)?.label ||
              selectedInstitution ||
              "Todas"}
          </span>
        </div>
      </div>

      {readinessError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center justify-between"
        >
          <span>{readinessError}</span>
          <button
            type="button"
            disabled={loadingReadiness}
            onClick={onRetryReadiness}
            className="font-semibold underline ml-2 cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!readinessError && (
        <div aria-busy={loadingReadiness} className="space-y-6">
          <p className="text-xs text-muted-foreground font-mono-lab">
            Dados exibidos: {examReadiness.institution || "Todas as bancas"}
            {loadingReadiness ? " · Atualizando…" : ""}
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
            {/* Summary Gauge */}
            <div className="lg:col-span-1 bg-canvas border border-line-subtle rounded-md p-5 flex flex-col justify-between gap-4">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Prontidão Estimada
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-mono-lab tabular-nums font-bold text-foreground tracking-tight">
                      {hasSufficientReadinessEvidence &&
                      examReadiness.readiness_score !== undefined
                        ? `${Math.round(examReadiness.readiness_score * 100)}%`
                        : "—"}
                    </span>
                    {hasSufficientReadinessEvidence &&
                      examReadiness.ci_lower !== undefined &&
                      examReadiness.ci_upper !== undefined && (
                        <span className="text-xs font-mono-lab text-muted-foreground font-medium">
                          [{Math.round(examReadiness.ci_lower * 100)}% –{" "}
                          {Math.round(examReadiness.ci_upper * 100)}%]
                        </span>
                      )}
                  </div>
                </div>

                {examReadiness.evidence_status === "insufficient" && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[11px] font-semibold bg-warning/10 text-warning border border-warning/25">
                    Evidência Inicial
                  </span>
                )}
                {examReadiness.evidence_status === "forming" && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[11px] font-semibold bg-primary/10 text-primary border border-primary/25">
                    Evidência em Formação
                  </span>
                )}
                {examReadiness.evidence_status === "reliable" && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[11px] font-semibold bg-success/10 text-success border border-success/25">
                    Evidência Confiável
                  </span>
                )}
              </div>

              {!hasSufficientReadinessEvidence ? (
                <div className="rounded-md bg-surface border border-line-subtle p-3 space-y-2.5 my-auto">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">
                      Calibração da Evidência
                    </span>
                    <span className="font-mono-lab tabular-nums font-medium text-warning">
                      {examReadiness.areas.filter((a) => a.attempts >= 5).length}/
                      {examReadiness.areas.length || 5} áreas qualificadas
                    </span>
                  </div>
                  <div className="h-2 w-full bg-surface-subtle rounded-xs overflow-hidden flex gap-1 p-0.5">
                    {(examReadiness.areas.length > 0
                      ? examReadiness.areas
                      : Array(5).fill(null)
                    ).map((a, i) => {
                      const att = a?.attempts ?? 0;
                      const isQualified = att >= 5;
                      const isStarted = att > 0;
                      return (
                        <div
                          key={a?.area || i}
                          title={
                            a
                              ? `${a.area}: ${att} tentativas (mínimo 5)`
                              : undefined
                          }
                          className={clsx(
                            "h-full flex-1 rounded-xs transition-all",
                            isQualified
                              ? "bg-success"
                              : isStarted
                              ? "bg-warning"
                              : "bg-muted-foreground/20"
                          )}
                        />
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Meta mínima de 5 questões por área para produzir uma estimativa
                    responsável e liberar a nota de prontidão.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 py-1 my-auto">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Intervalo de Credibilidade (95%)</span>
                    <span className="font-mono-lab tabular-nums font-semibold text-foreground">
                      {examReadiness.ci_lower !== undefined &&
                      examReadiness.ci_upper !== undefined
                        ? `${Math.round(examReadiness.ci_lower * 100)}% a ${Math.round(
                            examReadiness.ci_upper * 100
                          )}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="relative h-2 w-full bg-surface-subtle rounded-xs overflow-hidden">
                    {examReadiness.ci_lower !== undefined &&
                      examReadiness.ci_upper !== undefined && (
                        <div
                          className="absolute h-full bg-primary/30 rounded-xs"
                          style={{
                            left: `${Math.max(
                              0,
                              Math.round(examReadiness.ci_lower * 100)
                            )}%`,
                            width: `${Math.max(
                              4,
                              Math.round(
                                (examReadiness.ci_upper - examReadiness.ci_lower) *
                                  100
                              )
                            )}%`,
                          }}
                        />
                      )}
                    {examReadiness.readiness_score !== undefined && (
                      <div
                        className="absolute top-0 h-full w-2 bg-primary rounded-xs -ml-1"
                        style={{
                          left: `${Math.max(
                            0,
                            Math.min(
                              100,
                              Math.round(examReadiness.readiness_score * 100)
                            )
                          )}%`,
                        }}
                      />
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2 text-xs border-t border-line-subtle pt-3">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Edital:</span>
                  <span className="font-semibold text-foreground">
                    {examReadiness.edital_profile
                      ? `${examReadiness.edital_profile.institution_label} (v${examReadiness.edital_profile.version})`
                      : "Padrão"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Status do Perfil:</span>
                  <span
                    className={clsx(
                      "font-semibold text-[11px] px-2 py-0.5 rounded-xs",
                      examReadiness.edital_profile?.status === "validated"
                        ? "bg-success/10 text-success"
                        : "bg-primary/10 text-primary"
                    )}
                  >
                    {examReadiness.edital_profile?.status === "validated"
                      ? "Validado"
                      : "Experimental"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Cobertura no Escopo:</span>
                  <span className="font-mono-lab tabular-nums font-medium text-foreground">
                    {Math.round(examReadiness.coverage * 100)}% (
                    {examReadiness.answered}/{examReadiness.available} q.)
                  </span>
                </div>
              </div>
            </div>

            {/* Key Factors */}
            <div className="lg:col-span-2 bg-canvas border border-line-subtle rounded-md p-5 flex flex-col justify-between gap-3">
              <h3 className="text-sm font-bold text-foreground">
                Fatores Determinantes para Calibrar a Evidência
              </h3>

              {examReadiness.evidence_status === "insufficient" && (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-foreground space-y-1">
                  <p className="font-semibold">Amostra Preliminar:</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Ainda não exibimos uma pontuação de prontidão: faltam tentativas nas
                    áreas ponderadas. Resolva as questões recomendadas para produzir uma
                    estimativa responsável.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {(examReadiness.key_factors || []).slice(0, 3).map((factor, idx) => {
                  let targetUrl =
                    factor.action_url ||
                    `/estudar?area=${encodeURIComponent(
                      factor.area
                    )}&status=new&limit=5`;
                  if (selectedInstitution && !targetUrl.includes("institution=")) {
                    const sep = targetUrl.includes("?") ? "&" : "?";
                    targetUrl = `${targetUrl}${sep}institution=${encodeURIComponent(
                      selectedInstitution
                    )}`;
                  }
                  return (
                    <div
                      key={idx}
                      className="rounded-md border border-line-subtle p-3.5 bg-surface text-xs flex flex-col md:flex-row md:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground">
                            {factor.area}
                          </span>
                          <span
                            className={clsx(
                              "px-1.5 py-0.5 rounded-xs text-[10px] font-semibold",
                              factor.factor_type === "low_sample"
                                ? "bg-warning/10 text-warning"
                                : "bg-primary/10 text-primary"
                            )}
                          >
                            {factor.factor_type === "low_sample"
                              ? "Poucas questões"
                              : "Prioritário"}
                          </span>
                        </div>
                        <p className="text-muted-foreground leading-relaxed">
                          {factor.impact}
                        </p>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 pt-2 md:pt-0 border-t md:border-t-0 border-line-subtle shrink-0 max-w-full md:max-w-[50%]">
                        <span className="text-foreground/90 font-medium text-xs leading-snug break-words">
                          {factor.recommendation}
                        </span>
                        <Link
                          href={targetUrl}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold text-xs hover:bg-primary/90 transition-colors shrink-0 self-start sm:self-auto"
                        >
                          Resolver
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Competitive Analysis */}
          {examReadiness.competitive_analysis && (
            <div className="bg-canvas border border-line-subtle rounded-md p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line-subtle pb-3">
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    Análise Competitiva Real da Banca & Ponderação Psicométrica
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Comparação item a item contra o histórico de acertos dos candidatos
                    nas provas oficiais desta instituição.
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Média da Concorrência:</span>
                    <span className="font-mono-lab tabular-nums font-bold text-foreground">
                      {Math.round(
                        examReadiness.competitive_analysis.candidate_mean * 100
                      )}
                      %
                    </span>
                  </div>
                  {examReadiness.competitive_analysis.competitive_delta !== null && (
                    <span
                      className={clsx(
                        "px-2 py-0.5 rounded-xs text-xs font-mono-lab tabular-nums font-bold border",
                        examReadiness.competitive_analysis.competitive_delta >= 0
                          ? "bg-success/10 text-success border-success/25"
                          : "bg-destructive/10 text-destructive border-destructive/25"
                      )}
                    >
                      Δ{" "}
                      {examReadiness.competitive_analysis.competitive_delta >= 0
                        ? `+${Math.round(
                            examReadiness.competitive_analysis.competitive_delta *
                              100
                          )}%`
                        : `${Math.round(
                            examReadiness.competitive_analysis.competitive_delta *
                              100
                          )}%`}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-md bg-surface border border-line-subtle flex flex-col justify-between">
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Ponderação por Dificuldade (IRT-like)
                    </span>
                    <h4 className="font-bold text-sm text-foreground">
                      Score Ajustado por Item
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Valoriza acertos em questões difíceis e penaliza erros em itens
                      fáceis.
                    </p>
                  </div>
                  <div className="pt-3 flex items-baseline gap-2">
                    <span className="text-2xl font-mono-lab tabular-nums font-bold text-primary">
                      {examReadiness.competitive_analysis
                        .difficulty_adjusted_score !== null
                        ? `${Math.round(
                            examReadiness.competitive_analysis
                              .difficulty_adjusted_score * 100
                          )}%`
                        : "—"}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono-lab">
                      {examReadiness.competitive_analysis.competitive_ratio !== null
                        ? `(${examReadiness.competitive_analysis.competitive_ratio}x a média)`
                        : ""}
                    </span>
                  </div>
                </div>

                <div className="md:col-span-2 p-4 rounded-md bg-surface border border-line-subtle space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Desempenho Estratificado por Dificuldade da Prova
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Você vs Candidatos Reais
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(
                      [
                        ["Itens Fáceis", examReadiness.competitive_analysis.difficulty_breakdown.facil],
                        ["Itens Médios", examReadiness.competitive_analysis.difficulty_breakdown.media],
                        ["Itens Difíceis", examReadiness.competitive_analysis.difficulty_breakdown.dificil],
                      ] as const
                    ).map(([label, tier]) => {
                      const uAcc =
                        tier.user_accuracy !== null
                          ? Math.round(tier.user_accuracy * 100)
                          : null;
                      const cAcc = Math.round(tier.candidate_accuracy * 100);
                      return (
                        <div
                          key={label}
                          className="p-3 rounded-xs bg-canvas border border-line-subtle flex flex-col justify-between gap-1.5"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground">
                              {label}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono-lab">
                              {tier.attempts} q.
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between pt-1">
                            <span className="text-base font-mono-lab tabular-nums font-bold text-foreground">
                              {uAcc !== null ? `${uAcc}%` : "—"}
                            </span>
                            <span className="text-xs font-mono-lab text-muted-foreground">
                              Banca: {cAcc}%
                            </span>
                          </div>
                          {tier.delta !== null && (
                            <span
                              className={clsx(
                                "text-[10px] font-mono-lab font-semibold self-start",
                                tier.delta >= 0
                                  ? "text-success"
                                  : "text-destructive"
                              )}
                            >
                              Δ{" "}
                              {tier.delta >= 0
                                ? `+${Math.round(tier.delta * 100)}%`
                                : `${Math.round(tier.delta * 100)}%`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Grande Área Breakdown */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-foreground">
              Distribuição por Grande Área no Edital
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
              {examReadiness.areas.map((area) => {
                const meanPct =
                  area.attempts > 0
                    ? area.posterior_mean !== undefined
                      ? Math.round(area.posterior_mean * 100)
                      : area.accuracy !== null
                      ? Math.round(area.accuracy * 100)
                      : null
                    : null;
                const wPct =
                  area.weight !== undefined ? Math.round(area.weight * 100) : 20;
                const sampleBadge =
                  area.attempts >= 20
                    ? {
                        label: "Calibrada",
                        cls: "bg-success/10 text-success border-success/25",
                      }
                    : area.attempts >= 5
                    ? {
                        label: "Em formação",
                        cls: "bg-primary/10 text-primary border-primary/25",
                      }
                    : {
                        label: "Amostra inicial",
                        cls: "bg-warning/10 text-warning border-warning/25",
                      };

                const ciLowerPct =
                  area.ci_lower !== undefined ? Math.round(area.ci_lower * 100) : null;
                const ciUpperPct =
                  area.ci_upper !== undefined ? Math.round(area.ci_upper * 100) : null;
                const candAreaPct =
                  area.candidate_accuracy !== undefined
                    ? Math.round(area.candidate_accuracy * 100)
                    : null;
                const deltaAreaPct =
                  area.competitive_delta !== null &&
                  area.competitive_delta !== undefined
                    ? Math.round(area.competitive_delta * 100)
                    : null;

                let areaUrl =
                  area.action ||
                  `/estudar?area=${encodeURIComponent(area.area)}&status=new&limit=20`;
                if (selectedInstitution && !areaUrl.includes("institution=")) {
                  const sep = areaUrl.includes("?") ? "&" : "?";
                  areaUrl = `${areaUrl}${sep}institution=${encodeURIComponent(
                    selectedInstitution
                  )}`;
                }

                return (
                  <div
                    key={area.area}
                    className="rounded-md border border-line-subtle p-4 bg-canvas flex flex-col justify-between gap-3.5 hover:border-primary/40 transition-colors"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-1.5">
                        <span className="text-[11px] font-mono-lab font-semibold text-muted-foreground uppercase tracking-wider">
                          Peso {wPct}%
                        </span>
                        <span
                          className={clsx(
                            "text-[10px] font-semibold px-1.5 py-0.5 rounded-xs border",
                            sampleBadge.cls
                          )}
                        >
                          {sampleBadge.label}
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between gap-2">
                        <h4
                          className="font-bold text-sm text-foreground line-clamp-1"
                          title={area.area}
                        >
                          {area.area}
                        </h4>
                        <div className="text-right shrink-0">
                          <span className="text-lg font-mono-lab tabular-nums font-bold text-foreground">
                            {meanPct !== null ? `${meanPct}%` : "—"}
                          </span>
                          <span className="block text-[10px] text-muted-foreground -mt-0.5">
                            Posterior
                          </span>
                        </div>
                      </div>

                      {candAreaPct !== null && (
                        <div className="flex items-center justify-between text-[11px] pt-0.5 font-mono-lab tabular-nums">
                          <span className="text-muted-foreground">
                            Banca: {candAreaPct}%
                          </span>
                          {deltaAreaPct !== null && (
                            <span
                              className={clsx(
                                "font-semibold text-[10px] px-1 rounded-xs",
                                deltaAreaPct >= 0
                                  ? "bg-success/10 text-success"
                                  : "bg-destructive/10 text-destructive"
                              )}
                            >
                              Δ{" "}
                              {deltaAreaPct >= 0
                                ? `+${deltaAreaPct}%`
                                : `${deltaAreaPct}%`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5 py-1">
                      <div className="relative h-1.5 w-full bg-surface-subtle rounded-xs overflow-hidden">
                        {ciLowerPct !== null && ciUpperPct !== null && (
                          <div
                            className="absolute h-full bg-primary/25 rounded-xs"
                            style={{
                              left: `${Math.max(0, ciLowerPct)}%`,
                              width: `${Math.max(4, ciUpperPct - ciLowerPct)}%`,
                            }}
                          />
                        )}
                        {meanPct !== null && (
                          <div
                            className="absolute top-0 h-full w-1.5 bg-primary rounded-xs -ml-0.5"
                            style={{
                              left: `${Math.max(0, Math.min(100, meanPct))}%`,
                            }}
                          />
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono-lab tabular-nums">
                        <span className="font-sans">
                          {area.attempts}{" "}
                          {area.attempts === 1 ? "tentativa" : "tentativas"}
                        </span>
                        {ciLowerPct !== null && ciUpperPct !== null && (
                          <span>
                            [{ciLowerPct}% – {ciUpperPct}%]
                          </span>
                        )}
                      </div>
                    </div>

                    <Link
                      href={areaUrl}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors w-full"
                    >
                      Estudar Área
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-line-subtle text-xs text-muted-foreground space-y-1">
            <p>
              {loadingReadiness ? "Atualizando escopo…" : examReadiness.disclaimer}
            </p>
            {examReadiness.limitations && examReadiness.limitations.length > 0 && (
              <ul className="list-disc list-inside text-[11px] text-muted-foreground/80 space-y-0.5 pt-1">
                {examReadiness.limitations.map((lim, idx) => (
                  <li key={idx}>{lim}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

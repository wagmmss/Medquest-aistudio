"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  TrendingUp,
  Award,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  Compass,
  ArrowUpRight,
  Minus,
  ArrowDownRight,
  ShieldCheck,
  Building2,
  Info
} from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { QuestionListItem, BatchAttemptResultItem, TriEvaluationResponse, SpecialtyCutoff } from "@/types/api";

const AVAILABLE_INSTITUTIONS = [
  { code: "ENARE", label: "ENARE (Exame Nacional de Residência)" },
  { code: "USP-SP", label: "USP-SP (Faculdade de Medicina da USP)" },
  { code: "USP-RP", label: "USP-RP (FMRP Ribeirão Preto)" },
  { code: "SUS-SP", label: "SUS-SP (Secretaria de Saúde de SP)" },
  { code: "UNIFESP", label: "UNIFESP (Escola Paulista de Medicina)" },
  { code: "UNICAMP", label: "UNICAMP (Campinas)" },
];

function normalizeInstitutionCode(code?: string): string {
  const upper = (code || "ENARE").trim().toUpperCase();
  if (upper === "USP" || upper === "FMUSP") return "USP-SP";
  if (upper === "FMRP") return "USP-RP";
  if (upper === "SUS") return "SUS-SP";
  if (upper === "EPM") return "UNIFESP";
  if (AVAILABLE_INSTITUTIONS.some((inst) => inst.code === upper)) return upper;
  return "ENARE";
}

export interface SimuladoTriScorecardProps {
  queue: QuestionListItem[];
  resultsMap: Record<number, BatchAttemptResultItem>;
  initialInstitution?: string;
}

export const SimuladoTriScorecard: React.FC<SimuladoTriScorecardProps> = ({
  queue,
  resultsMap,
  initialInstitution = "ENARE",
}) => {
  const [selectedInst, setSelectedInst] = useState<string>(() =>
    normalizeInstitutionCode(initialInstitution)
  );
  const [triData, setTriData] = useState<TriEvaluationResponse | null>(null);
  const [showMethodology, setShowMethodology] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Prepara respostas do simulado de forma memorizada (excluindo questões discursivas não avaliadas objetivamente)
  const responses = useMemo(() => {
    return queue
      .filter((q) => !resultsMap[q.id]?.is_discursive)
      .map((q) => {
        const res = resultsMap[q.id];
        return {
          question_id: q.id,
          is_correct: Boolean(res?.is_correct),
        };
      });
  }, [queue, resultsMap]);

  const hasResponses = responses.length > 0;
  const [loading, setLoading] = useState<boolean>(hasResponses);

  const handleInstitutionChange = (newInst: string) => {
    setSelectedInst(normalizeInstitutionCode(newInst));
    setLoading(true);
    setFetchError(null);
  };

  useEffect(() => {
    if (!hasResponses) {
      return;
    }

    const controller = new AbortController();

    api.questions
      .evaluateTri(
        {
          responses,
          institution_code: selectedInst,
        },
        controller.signal
      )
      .then((data) => {
        setTriData(data);
        setLoading(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error("Erro ao calcular nota TRI do simulado:", err);
          setFetchError("Não foi possível carregar a avaliação TRI da banca.");
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedInst, responses, hasResponses]);

  if (!hasResponses) {
    return null;
  }

  const getStatusBadge = (status: SpecialtyCutoff["status"]) => {
    switch (status) {
      case "HIGH_PROBABILITY":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-success/10 text-success border border-success/30">
            <CheckCircle2 size={13} className="shrink-0" />
            Alta Probabilidade
          </span>
        );
      case "COMPETITIVE":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-warning/10 text-warning border border-warning/30">
            <AlertCircle size={13} className="shrink-0" />
            Zona de Corte
          </span>
        );
      case "NEEDS_IMPROVEMENT":
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/30">
            <Minus size={13} className="shrink-0" />
            Abaixo do Corte
          </span>
        );
    }
  };

  const getDiffBadge = (diff: number) => {
    const safeDiff = Number.isFinite(diff) ? diff : 0;
    if (safeDiff > 0) {
      return (
        <span className="inline-flex items-center text-xs font-bold text-success font-mono-lab tabular-nums">
          <ArrowUpRight size={14} />+{safeDiff.toFixed(1)} pts
        </span>
      );
    }
    if (safeDiff === 0) {
      return (
        <span className="inline-flex items-center text-xs font-bold text-muted-foreground">
          No corte exato
        </span>
      );
    }
    return (
      <span className="inline-flex items-center text-xs font-bold text-destructive font-mono-lab tabular-nums">
        <ArrowDownRight size={14} />{safeDiff.toFixed(1)} pts
      </span>
    );
  };

  const safeProjectedScore = Number.isFinite(Number(triData?.projected_score))
    ? Number(triData?.projected_score)
    : 0;
  const safePercentile = Number.isFinite(Number(triData?.national_percentile))
    ? Number(triData?.national_percentile)
    : 0;
  const safeCoherence = Number.isFinite(Number(triData?.pedagogical_coherence_pct))
    ? Number(triData?.pedagogical_coherence_pct)
    : 0;
  const safeRawScorePct = Number.isFinite(Number(triData?.raw_score_pct))
    ? Number(triData?.raw_score_pct)
    : 0;

  return (
    <div className="w-full max-w-3xl bg-surface border border-line-subtle rounded-lg p-5 sm:p-6 mb-6 text-left">
      {/* Header com Seletor de Banca */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line-subtle">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-accent/10 text-accent flex items-center justify-center shrink-0">
            <TrendingUp size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-foreground">Scorecard TRI &amp; Ranking Preditivo</h3>
              <span className="text-[11px] font-semibold text-accent uppercase tracking-wider">
                · 3PL
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Projeção calculada por Teoria de Resposta ao Item com quadratura numérica EAP.
            </p>
          </div>
        </div>

        {/* Seletor de Banca */}
        <div className="flex items-center gap-2 shrink-0">
          <Building2 size={16} className="text-muted-foreground" />
          <select
            value={selectedInst}
            onChange={(e) => handleInstitutionChange(e.target.value)}
            disabled={loading}
            className="text-xs sm:text-sm font-semibold bg-canvas hover:bg-muted text-foreground border border-line-subtle rounded-md px-3 py-1.5 outline-none transition-colors cursor-pointer"
          >
            {AVAILABLE_INSTITUTIONS.map((inst) => (
              <option key={inst.code} value={inst.code}>
                {inst.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="py-10 flex flex-col items-center justify-center gap-3">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-muted-foreground font-medium">
            Calibrando parâmetros 3PL e estimando proficiência a posteriori...
          </p>
        </div>
      ) : fetchError ? (
        <div className="py-6 text-center text-sm text-destructive font-medium">
          {fetchError}
        </div>
      ) : triData ? (
        <div className="pt-5 space-y-5">
          {/* Grid de Métricas Principais */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {/* 1. Nota TRI Projetada */}
            <div className="bg-canvas border border-line-subtle rounded-md p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span>Nota TRI Projetada</span>
                <Award size={15} className="text-accent" />
              </div>
              <div className="my-2 font-mono-lab tabular-nums">
                <span className="text-2xl font-bold text-foreground">
                  {safeProjectedScore.toFixed(1)}
                </span>
                <span className="text-xs text-muted-foreground ml-1.5 font-semibold">/ 100</span>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono-lab tabular-nums">
                Acerto bruto: <strong className="text-foreground">{safeRawScorePct}%</strong> ({queue.filter(q => resultsMap[q.id]?.is_correct).length}/{queue.length})
              </div>
            </div>

            {/* 2. Percentil Nacional */}
            <div className="bg-canvas border border-line-subtle rounded-md p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span>Percentil Nacional</span>
                <Compass size={15} className="text-success" />
              </div>
              <div className="my-2 font-mono-lab tabular-nums">
                <span className="text-2xl font-bold text-success">
                  {safePercentile >= 50
                    ? `Top ${(100 - safePercentile).toFixed(1)}%`
                    : `${safePercentile.toFixed(1)}º Perc.`}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono-lab tabular-nums">
                Acima de <strong className="text-foreground">{safePercentile}%</strong> dos concorrentes.
              </div>
            </div>

            {/* 3. Coerência Pedagógica */}
            <div className="bg-canvas border border-line-subtle rounded-md p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span>Coerência Pedagógica</span>
                <ShieldCheck size={15} className="text-primary" />
              </div>
              <div className="my-2">
                <div className="flex items-baseline gap-1 font-mono-lab tabular-nums">
                  <span className="text-2xl font-bold text-foreground">
                    {safeCoherence.toFixed(0)}%
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">índice</span>
                </div>
              </div>
              <div className="w-full bg-border h-1.5 rounded-xs overflow-hidden mb-1">
                <div
                  className={clsx(
                    "h-full rounded-full transition-all duration-500",
                    safeCoherence >= 85
                      ? "bg-success"
                      : safeCoherence >= 70
                      ? "bg-warning"
                      : "bg-destructive"
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, safeCoherence))}%` }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground truncate" title={triData.coherence_label}>
                {safeCoherence >= 85
                  ? "Consistência sólida"
                  : safeCoherence >= 70
                  ? "Distribuição balanceada"
                  : "Oscilações por chute"}
              </div>
            </div>
          </div>

          {/* Banner de Feedback de Coerência */}
          <div className="bg-muted/20 border border-border/80 rounded-xl p-3.5 flex items-start gap-3">
            <Info size={17} className="text-primary shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground font-semibold">Diagnóstico TRI: </strong>
              {triData.coherence_label}
            </div>
          </div>

          {/* Termômetro de Corte por Especialidades Médicas */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                <span>Termômetro de Corte por Especialidade ({triData.institution_code})</span>
              </h4>
              <span className="text-[11px] text-muted-foreground">
                Baseado nos editais oficiais mais recentes
              </span>
            </div>

            <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
              {(triData.specialty_cutoffs || []).map((spec) => {
                const safeSpecCutoff = Number.isFinite(Number(spec.cutoff_score))
                  ? Number(spec.cutoff_score)
                  : 0;
                return (
                  <div
                    key={spec.specialty}
                    className="p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm text-foreground">
                        {spec.specialty}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 sm:gap-6 self-end sm:self-auto">
                      <div className="text-right">
                        <div className="text-xs font-semibold text-foreground font-mono-lab tabular-nums">
                          Nota de Corte: {safeSpecCutoff.toFixed(1)}
                        </div>
                        <div className="text-[11px]">
                          {getDiffBadge(spec.difference)}
                        </div>
                      </div>

                      <div className="min-w-[150px] text-right">
                        {getStatusBadge(spec.status)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Acordeão de Metodologia TRI */}
          <div className="pt-2">
            <button
              onClick={() => setShowMethodology(!showMethodology)}
              className="text-xs text-muted-foreground hover:text-foreground font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <HelpCircle size={14} />
              {showMethodology ? "Ocultar detalhes da metodologia TRI" : "Como a TRI calcula sua nota e evita chutes?"}
            </button>

            {showMethodology && (
              <div className="mt-3 bg-muted/20 border border-border rounded-xl p-4 text-xs text-muted-foreground space-y-2 leading-relaxed animate-in fade-in-50">
                <p>
                  <strong className="text-foreground">Modelo Logístico 3PL:</strong> Diferente de uma prova com pontuação linear bruta, a TRI avalia três parâmetros essenciais em cada questão médica:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Parâmetro a (Discriminação):</strong> Mede o poder da questão de diferenciar candidatos de alto e baixo rendimento.</li>
                  <li><strong>Parâmetro b (Dificuldade):</strong> Ponto da escala de proficiência onde a probabilidade de acerto é de 50%.</li>
                  <li><strong>Parâmetro c (Acerto ao acaso / Chute):</strong> Probabilidade de um candidato sem domínio acertar a questão por eliminação ou sorte.</li>
                </ul>
                <p>
                  <strong className="text-foreground">Coerência Pedagógica:</strong> Candidatos que erram questões fáceis e acertam apenas questões muito difíceis têm probabilidade elevada de acerto por chute, reduzindo o valor agregado desses pontos e alinhando sua projeção à realidade dos grandes concursos como ENARE e USP.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

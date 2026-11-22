"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Sparkles,
  AlertTriangle,
  RotateCcw,
  Brain,
  X,
  ExternalLink,
} from "lucide-react";
import { BottleneckTopic, PreceptorFocusResponse } from "@/types/api";
import { api } from "@/lib/api";

const FormattedContent = dynamic(
  () => import("@/components/FormattedContent").then((m) => m.FormattedContent),
  {
    ssr: false,
    loading: () => <div className="h-32 w-full rounded-md bg-elevated/40 animate-pulse" />,
  }
);

interface PreceptorXrayButtonProps {
  initialBottlenecks?: BottleneckTopic[];
}

export const PreceptorXrayButton = React.memo(function PreceptorXrayButton({
  initialBottlenecks = [],
}: PreceptorXrayButtonProps) {
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [focusData, setFocusData] = useState<PreceptorFocusResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const topBottleneck = initialBottlenecks.length > 0 ? initialBottlenecks[0] : null;
  const currentSubtema =
    focusData?.recommended_topic?.subtema ||
    topBottleneck?.subtema ||
    "Síndromes Coronarianas Agudas";
  const practiceUrl =
    focusData?.recommended_topic?.practice_url ||
    (topBottleneck
      ? topBottleneck.practice_url
      : `/estudar?subtema=${encodeURIComponent(currentSubtema)}&limit=15`);

  useEffect(() => {
    if (!isOpenModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpenModal(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpenModal]);

  const handleOpenAiDiagnosis = async (forceRefresh = false) => {
    setIsOpenModal(true);
    if (focusData?.analysis_markdown && !forceRefresh) {
      return;
    }

    setLoadingAi(true);
    setErrorMsg(null);
    try {
      const data = await api.ai.getPreceptorFocus({ generateAi: true, forceRefresh });
      setFocusData(data);
    } catch (err: unknown) {
      console.error("Falha ao obter foco do Preceptor IA:", err);
      const msg =
        err instanceof Error
          ? err.message
          : "Não foi possível carregar o diagnóstico da IA no momento.";
      setErrorMsg(msg);
    } finally {
      setLoadingAi(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenAiDiagnosis(false)}
        className="px-2.5 py-1 rounded-xs border border-line-subtle bg-elevated hover:bg-line-subtle text-ink-primary font-bold text-xs transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
      >
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        <span>Raio-X do Preceptor</span>
      </button>

      {isOpenModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preceptor-focus-title"
          onClick={() => setIsOpenModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-lg border border-line-subtle bg-surface shadow-2xl overflow-hidden"
          >
            {/* Header do Modal */}
            <div className="flex items-center justify-between border-b border-line-subtle p-4 sm:p-5 bg-elevated/40">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/10 text-accent border border-accent/25">
                  <Brain className="h-4.5 w-4.5" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono-lab text-[10px] font-bold uppercase tracking-wider text-accent">
                      Preceptor Socrático
                    </span>
                    <span className="font-mono-lab text-[10px] font-semibold bg-elevated text-ink-secondary px-1.5 py-0.5 rounded-xs border border-line-subtle">
                      Diagnóstico de Alto Rendimento
                    </span>
                  </div>
                  <h3
                    id="preceptor-focus-title"
                    className="text-base font-bold text-ink-primary tracking-tight"
                  >
                    Raio-X de Desempenho &amp; Diretriz do Dia
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleOpenAiDiagnosis(true)}
                  disabled={loadingAi}
                  title="Atualizar diagnóstico com IA"
                  aria-label="Atualizar diagnóstico com IA"
                  className="p-2 text-ink-muted hover:text-ink-primary hover:bg-elevated rounded-md transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RotateCcw
                    className={`h-4 w-4 ${loadingAi ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpenModal(false)}
                  aria-label="Fechar diagnóstico do Preceptor IA"
                  className="p-2 text-ink-muted hover:text-ink-primary hover:bg-elevated rounded-md transition-colors cursor-pointer"
                >
                  <X className="h-4.5 w-4.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Conteúdo do Modal */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {loadingAi ? (
                <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                  <div className="relative flex items-center justify-center">
                    <div className="h-12 w-12 rounded-full border-2 border-accent/20 border-t-accent animate-spin" />
                    <Brain className="h-5 w-5 text-accent absolute" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-ink-primary">
                      O Preceptor IA está avaliando seu perfil...
                    </h4>
                    <p className="text-xs text-ink-secondary mt-1 max-w-sm">
                      Cruzando suas tentativas e erros com as armadilhas mais recorrentes das grandes bancas (USP, ENARE, UNIFESP e SUS-SP).
                    </p>
                  </div>
                </div>
              ) : errorMsg ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-center">
                  <AlertTriangle className="h-5 w-5 text-destructive mx-auto mb-2" />
                  <p className="text-sm font-semibold text-destructive">{errorMsg}</p>
                  <button
                    type="button"
                    onClick={() => handleOpenAiDiagnosis(true)}
                    className="mt-3 px-4 py-1.5 bg-destructive text-white rounded-md text-xs font-bold hover:bg-destructive/90 transition-colors cursor-pointer"
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : focusData?.analysis_markdown ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <FormattedContent content={focusData.analysis_markdown} />
                </div>
              ) : (
                <p className="text-sm text-ink-secondary text-center py-8">
                  Clique no botão para gerar seu parecer com o Preceptor IA.
                </p>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="border-t border-line-subtle p-4 bg-elevated/30 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-ink-secondary text-center sm:text-left">
                Plano direcionado para bancas paulistas e nacionais.
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setIsOpenModal(false)}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-md border border-line-subtle hover:bg-elevated text-ink-primary text-xs font-semibold transition-colors cursor-pointer"
                >
                  Fechar
                </button>
                <Link
                  href={practiceUrl}
                  onClick={() => setIsOpenModal(false)}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-md bg-accent hover:bg-accent/90 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-2xs"
                >
                  <span>Iniciar Bateria (15 Qs)</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

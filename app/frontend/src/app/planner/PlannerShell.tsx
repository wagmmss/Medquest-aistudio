"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchPlannerBundle } from "@/lib/queries/plannerBundle";
import type { PlannerOrganizationMode } from "@/types/api";
import { PlannerWizard } from "./PlannerWizard";
import { PlannerClient } from "./PlannerClient";

export function PlannerShell({
  isIntensive,
  initialOrganization,
}: {
  isIntensive: boolean;
  initialOrganization?: PlannerOrganizationMode;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["planner-bundle", isIntensive, initialOrganization ?? "default"],
    queryFn: () => fetchPlannerBundle(isIntensive, initialOrganization),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading && !data) {
    return (
      <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Carregando cronograma">
        <div className="h-36 w-full rounded-2xl bg-surface border border-line-subtle" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-28 rounded-xl bg-surface border border-line-subtle" />
          <div className="h-28 rounded-xl bg-surface border border-line-subtle" />
          <div className="h-28 rounded-xl bg-surface border border-line-subtle" />
        </div>
        <div className="h-64 w-full rounded-2xl bg-surface border border-line-subtle" />
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <div className="w-12 h-12 bg-destructive/15 text-destructive rounded-2xl flex items-center justify-center mb-4 border border-destructive/20">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Erro ao carregar cronograma</h2>
        <p className="text-sm text-muted-foreground max-w-md mb-6">
          Não foi possível conectar ao servidor para obter seu plano de estudos.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const config = data?.config ?? null;
  const planResponse = data?.planResponse ?? null;

  if (!config || !config.exam_date || !config.start_date) {
    return (
      <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center min-h-[70vh]">
        <PlannerWizard />
      </div>
    );
  }

  if (!planResponse?.plan || planResponse.plan.length === 0) {
    return (
      <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center min-h-[70vh]">
        <div className="bg-destructive/10 text-destructive text-center p-6 rounded-xl border border-destructive/20 max-w-md">
          A data da prova precisa ser no futuro (ou não há temas no modo intensivo).
        </div>
        <div className="mt-8">
          <PlannerWizard initialConfig={config} />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500">
      <PlannerClient
        plan={planResponse.plan}
        completedTopicsOutside={planResponse.completed_topics ?? []}
        initialProgress={data?.progressMap ?? {}}
        initialTopicProgress={data?.topicProgressMap ?? {}}
        warning={planResponse.warning}
        isIntensive={isIntensive}
        organizationMode={data?.organization ?? "geral"}
        config={config}
      />
    </div>
  );
}

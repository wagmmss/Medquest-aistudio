"use client";

import type { QueryClient } from "@tanstack/react-query";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { api } from "@/lib/api";
import { fetchPlannerBundle } from "@/lib/queries/plannerBundle";

const prefetchedQueries = new Map<string, number>();
const PREFETCH_COOLDOWN_MS = 30_000;

/**
 * Pré-carrega o chunk da rota e, quando aplicável, os dados leves em cache
 * do TanStack Query no hover/toque para tornar a troca de aba instantânea.
 */
export function prefetchRouteIntent(
  href: string,
  router: AppRouterInstance,
  queryClient: QueryClient
) {
  router.prefetch(href);

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return;
  }

  const now = Date.now();
  const lastAt = prefetchedQueries.get(href) ?? 0;
  if (now - lastAt < PREFETCH_COOLDOWN_MS) {
    return;
  }

  if (href === "/") {
    prefetchedQueries.set(href, now);
    void queryClient.prefetchQuery({
      queryKey: ["dashboard-summary"],
      queryFn: () => api.stats.getDashboardSummary(),
      staleTime: 45_000,
    });
  } else if (href === "/estudar" || href === "/simulado" || href === "/buscar") {
    prefetchedQueries.set(href, now);
    void queryClient.prefetchQuery({
      queryKey: ["question-meta", "{}"],
      queryFn: () => api.questions.getMeta({}),
      staleTime: 60_000,
    });
  } else if (href === "/caderno") {
    prefetchedQueries.set(href, now);
    void queryClient.prefetchQuery({
      queryKey: ["smart-notebook", "", ""],
      queryFn: () => api.notes.list({}),
      staleTime: 60_000,
    });
  } else if (href === "/osce") {
    prefetchedQueries.set(href, now);
    void queryClient.prefetchQuery({
      queryKey: ["osce-stations"],
      queryFn: () => api.osce.getStations(),
      staleTime: 120_000,
    });
  } else if (href === "/analise") {
    prefetchedQueries.set(href, now);
    void queryClient.prefetchQuery({
      queryKey: ["analysis-summary", "USP-SP", ""],
      queryFn: () => api.stats.getAnalysisSummary("USP-SP"),
      staleTime: 60_000,
    });
  } else if (href === "/planner") {
    prefetchedQueries.set(href, now);
    void queryClient.prefetchQuery({
      queryKey: ["planner-bundle", false],
      queryFn: () => fetchPlannerBundle(false),
      staleTime: 60_000,
    });
  }
}

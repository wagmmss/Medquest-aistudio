"use client";

import { api } from "@/lib/api";
import type {
  PlannerConfig,
  PlannerOrganizationMode,
  PlannerPlanResponse,
  PlannerProgressMap,
  PlannerTopicProgressMap,
} from "@/types/api";

export interface PlannerBundle {
  config: PlannerConfig | null;
  planResponse: PlannerPlanResponse | null;
  progressMap: PlannerProgressMap;
  topicProgressMap: PlannerTopicProgressMap;
  organization: PlannerOrganizationMode;
}

export async function fetchPlannerBundle(
  isIntensive: boolean,
  organizationOverride?: PlannerOrganizationMode
): Promise<PlannerBundle> {
  const config = await api.planner.getConfig();
  const organization: PlannerOrganizationMode =
    organizationOverride ?? config?.organization_mode ?? "geral";

  if (!config || !config.exam_date || !config.start_date) {
    return {
      config: config ?? null,
      planResponse: null,
      progressMap: {},
      topicProgressMap: {},
      organization,
    };
  }

  const [planResponse, progressMap, topicProgressMap] = await Promise.all([
    api.planner.generatePlan({
      start_date: config.start_date,
      exam_date: config.exam_date,
      hours_per_week: Math.min(168, (config.days_per_week || 5) * (config.hours_per_day || 4)),
      intensive: isIntensive,
      organization,
    }),
    api.planner.getProgress(),
    api.planner.getTopicProgress(),
  ]);

  return {
    config,
    planResponse,
    progressMap,
    topicProgressMap,
    organization,
  };
}

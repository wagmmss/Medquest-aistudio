"use client";

import { api } from "@/lib/api";
import type {
  PlannerConfig,
  PlannerPlanResponse,
  PlannerProgressMap,
  PlannerTopicProgressMap,
} from "@/types/api";

export interface PlannerBundle {
  config: PlannerConfig | null;
  planResponse: PlannerPlanResponse | null;
  progressMap: PlannerProgressMap;
  topicProgressMap: PlannerTopicProgressMap;
}

export async function fetchPlannerBundle(isIntensive: boolean): Promise<PlannerBundle> {
  const config = await api.planner.getConfig();
  if (!config || !config.exam_date || !config.start_date) {
    return {
      config: config ?? null,
      planResponse: null,
      progressMap: {},
      topicProgressMap: {},
    };
  }

  const [planResponse, progressMap, topicProgressMap] = await Promise.all([
    api.planner.generatePlan({
      start_date: config.start_date,
      exam_date: config.exam_date,
      hours_per_week: Math.min(168, (config.days_per_week || 5) * (config.hours_per_day || 4)),
      intensive: isIntensive,
    }),
    api.planner.getProgress(),
    api.planner.getTopicProgress(),
  ]);

  return {
    config,
    planResponse,
    progressMap,
    topicProgressMap,
  };
}

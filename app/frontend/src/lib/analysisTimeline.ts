import type { TimelineStat } from "@/types/api";

/**
 * Slices an already-loaded timeline (e.g. 180-day history) to the last `days` calendar days
 * in memory, avoiding redundant API round-trips when toggling 14D / 30D / 90D / 180D.
 */
export function sliceTimelineByDays(
  timeline: TimelineStat[],
  days: number,
  referenceDate: Date = new Date()
): TimelineStat[] {
  if (!Array.isArray(timeline) || timeline.length === 0) return [];
  const safeDays = Math.max(1, Math.floor(days));
  const cutoff = new Date(referenceDate.getTime() - safeDays * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  return timeline
    .filter((entry) => typeof entry?.day === "string" && entry.day.slice(0, 10) >= cutoffIso)
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function normalizeTopicSearch(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

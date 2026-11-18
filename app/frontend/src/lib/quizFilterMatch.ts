const CORE_FILTER_KEYS = [
  "subtema",
  "area",
  "topic",
  "institution",
  "mode",
  "status",
  "year",
  "specialty",
  "q",
  "has_images",
  "unanswered_only",
] as const;

export function normalizeQuizFilters(
  filters: Record<string, string | string[]>
): Record<string, string> {
  const res: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (k === "resume") continue;
    if (Array.isArray(v)) {
      if (v.length > 0) {
        res[k] = [...v].sort().join(",");
      }
    } else if (v !== undefined && v !== "") {
      res[k] = String(v);
    }
  }
  return res;
}

export function areFiltersEquivalent(
  initial: Record<string, string | string[]>,
  saved: Record<string, string | string[]>
): boolean {
  const normInitial = normalizeQuizFilters(initial);
  const normSaved = normalizeQuizFilters(saved);

  for (const key of CORE_FILTER_KEYS) {
    if ((normInitial[key] || "") !== (normSaved[key] || "")) {
      return false;
    }
  }

  if (normInitial.limit && normSaved.limit && normInitial.limit !== normSaved.limit) {
    return false;
  }

  return true;
}

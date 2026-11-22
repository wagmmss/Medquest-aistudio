"use client";
import { useRouter } from "next/navigation";

import { useState, useEffect, memo, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PlannerWeek,
  PlannerProgressMap,
  PlannerTopic,
  PlannerConfig,
  PlannerTopicProgressMap,
  PlannerOrganizationMode,
  PlannerScheduleMode,
  LessonsSummaryBySubtemaItem,
} from "@/types/api";
import { api, OfflineQueuedError } from "@/lib/api";
import { useLessonsAccess } from "@/hooks/useLessonsAccess";
import { Check, CalendarDays, Clock, Activity, Loader2, RotateCcw, AlertTriangle, Zap, X, Play, PlayCircle, Settings2, Download, Gem, TrendingUp, AlertCircle, GripVertical, ArrowUpDown, ArrowRight, Copy, Lightbulb, Layers, CalendarRange, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import toast from "react-hot-toast";
import { InternatoBlocksModal } from "./InternatoBlocksModal";

const PlannerWizard = dynamic(
  () => import("./PlannerWizard").then((m) => m.PlannerWizard),
  {
    loading: () => (
      <div className="h-80 w-full max-w-3xl mx-auto rounded-xl bg-surface border border-line-subtle animate-pulse" />
    ),
  }
);

const getAreaColorClass = (areaName: string) => {
  const name = areaName.toLowerCase();
  if (name.includes("preventiva")) return "bg-area-preventiva text-area-preventiva";
  if (name.includes("pediatria")) return "bg-area-pediatria text-area-pediatria";
  if (name.includes("go") || name.includes("ginecologia")) return "bg-area-go text-area-go";
  if (name.includes("cirurgia")) return "bg-area-cirurgia text-area-cirurgia";
  return "bg-area-clinica text-area-clinica";
};

const formatHours = (hours: number) => hours.toLocaleString("pt-BR", {
  minimumFractionDigits: Number.isInteger(hours) ? 0 : 1,
  maximumFractionDigits: 1,
});

const formatRemainingSeconds = (seconds?: number) => {
  if (!seconds || seconds <= 0) return "";
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};


const TopicRow = memo(function TopicRow({ 
  t, 
  completed,
  toggleTopic,
  week,
  isDragging,
  isDragOverBefore,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onOpenMoveModal,
  lessonSummary,
}: { 
  t: PlannerTopic; 
  completed: boolean;
  toggleTopic: (week: number, subtema: string, completed: boolean) => void;
  week: number;
  isDragging?: boolean;
  isDragOverBefore?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onOpenMoveModal?: () => void;
  lessonSummary?: LessonsSummaryBySubtemaItem;
}) {
    const key = `planner-topic-${week}-${t.subtema}`;
  const isChecked = completed;

  return (
    <div className="relative flex flex-col">
      {isDragOverBefore && (
        <div className="h-1 w-full bg-accent rounded-xs mb-1" />
      )}
      <div 
        draggable={Boolean(onDragStart)}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={clsx(
          "flex items-start gap-2.5 py-2.5 px-3 rounded-xl border transition-all group",
          isDragging 
            ? "opacity-30 border-dashed border-primary bg-primary/10 scale-[0.99] shadow-inner" 
            : "border-transparent hover:border-border/60 hover:bg-muted/20"
        )}
      >
        {/* Grip Drag Handle */}
        <div 
          className="mt-1 shrink-0 text-muted-foreground/40 group-hover:text-primary cursor-grab active:cursor-grabbing hover:bg-primary/10 p-1 rounded-md transition-colors"
          title="Segure e arraste este bloco para mudar de semana ou reorganizar"
          aria-label="Arrastar bloco"
        >
          <GripVertical size={16} />
        </div>

        <div className="relative flex items-center mt-1 shrink-0">
          <input 
            type="checkbox"
            id={key}
            className="peer sr-only"
            checked={isChecked}
            onChange={() => toggleTopic(week, t.subtema, isChecked)}
            aria-label={`Concluir tema ${t.subtema}`}
          />
          <label 
            htmlFor={key}
            className="w-4 h-4 border border-muted-foreground/40 rounded transition-colors peer-checked:bg-primary peer-checked:border-primary flex items-center justify-center cursor-pointer hover:border-primary/60"
          >
            <Check size={10} className={clsx("text-primary-foreground transition-opacity", isChecked ? "opacity-100" : "opacity-0")} strokeWidth={4} />
          </label>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <label 
              htmlFor={key}
              className={clsx(
                "font-semibold text-sm leading-snug cursor-pointer transition-colors", 
                isChecked ? "text-muted-foreground line-through opacity-70" : "text-foreground group-hover:text-primary"
              )}
            >
              {t.subtema}
            </label>
            {t.priority_tier && t.priority_tier !== "Normal" && (
              <span
                title={t.priority_explanation || "Recomendação adaptativa"}
                className={clsx(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border cursor-help",
                  t.priority_tier === "Diamante" ? "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20" :
                  t.priority_tier === "Alta" ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20" :
                  "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                )}
              >
                {t.priority_tier === "Diamante" ? <Gem size={12} className="fill-current" /> :
                 t.priority_tier === "Alta" ? <TrendingUp size={12} /> : 
                 <AlertCircle size={12} />}
                {t.priority_tier}
              </span>
            )}
          </div>

          <div className="text-xs text-muted-foreground flex items-center flex-wrap gap-1.5 mt-1.5">
            <span className={clsx("font-medium", getAreaColorClass(t.area).split(" ")[1])}>{t.area}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Clock size={11} /> {formatHours(t.estimated_theory_hours)}h teóricas + {formatHours(t.estimated_practice_hours)}h questões = {formatHours(t.estimated_hours)}h
            </span>
            <span>•</span>
            <span>
              {t.questions_available} questões disponíveis
              {t.incidence_source === "target_banks" && typeof t.target_questions_count === "number"
                ? ` (${t.target_questions_count} nas suas bancas)`
                : ""}
            </span>
          </div>

          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            <Link href={`/analise?tab=cobertura&subtema=${encodeURIComponent(t.subtema)}`} className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent text-white text-xs font-semibold rounded-md">
              Abrir tema
            </Link>
            <Link 
              href={`/estudar?subtema=${encodeURIComponent(t.subtema)}&limit=25`}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent/10 hover:bg-accent/20 text-accent text-xs font-semibold rounded-md transition-colors border border-accent/20"
            >
              <Play size={11} className="fill-current" /> Praticar Questões
            </Link>
            {lessonSummary && lessonSummary.essential_total > 0 ? (
              <Link
                href={
                  lessonSummary.next_lesson_id
                    ? `/aulas?subtema=${encodeURIComponent(t.subtema)}&lesson=${lessonSummary.next_lesson_id}`
                    : `/aulas?subtema=${encodeURIComponent(t.subtema)}`
                }
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold rounded-md transition-colors border border-primary/20"
              >
                <PlayCircle size={12} /> Assistir aulas ({lessonSummary.essential_completed}/
                {lessonSummary.essential_total}
                {lessonSummary.remaining_duration_seconds
                  ? ` • ${formatRemainingSeconds(lessonSummary.remaining_duration_seconds)}`
                  : ""}
                )
              </Link>
            ) : lessonSummary && lessonSummary.total > 0 ? (
              <Link
                href={
                  lessonSummary.next_lesson_id
                    ? `/aulas?subtema=${encodeURIComponent(t.subtema)}&lesson=${lessonSummary.next_lesson_id}`
                    : `/aulas?subtema=${encodeURIComponent(t.subtema)}`
                }
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-elevated hover:bg-elevated/80 text-ink-secondary hover:text-ink-primary text-xs font-medium rounded-md transition-colors border border-line-subtle"
              >
                <PlayCircle size={12} /> Aulas extras ({lessonSummary.total})
              </Link>
            ) : null}
            {lessonSummary?.cycle?.pre_done && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-success/10 text-success border border-success/25">
                <Check size={11} /> Pré {lessonSummary.cycle.pre_completed > 0 ? `${lessonSummary.cycle.pre_completed}q` : "✓"}
              </span>
            )}
            {lessonSummary?.theory_completed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-success/10 text-success border border-success/25">
                <Check size={11} /> Teoria ✓
              </span>
            ) : lessonSummary?.essential_all_completed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-primary/10 text-primary border border-primary/25">
                <Check size={11} /> Aulas ✓
              </span>
            ) : null}
            {lessonSummary?.cycle?.post_done && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-success/10 text-success border border-success/25">
                <Check size={11} /> Pós {lessonSummary.cycle.post_completed > 0 ? `${lessonSummary.cycle.post_completed}q` : "✓"}
              </span>
            )}
            {onOpenMoveModal && (
              <button
                type="button"
                onClick={onOpenMoveModal}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs font-medium rounded-md transition-colors border border-line-subtle"
                title="Mover este tema para outra semana"
              >
                <ArrowUpDown size={12} className="text-accent" />
                Mover semana
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
TopicRow.displayName = "TopicRow";

interface PlannerClientProps {
  plan: PlannerWeek[];
  completedTopicsOutside?: PlannerTopic[];
  initialProgress: PlannerProgressMap;
  initialTopicProgress: PlannerTopicProgressMap;
  warning?: string;
  isIntensive?: boolean;
  organizationMode?: PlannerOrganizationMode;
  config?: PlannerConfig | null;
}

export function PlannerClient({
  plan,
  completedTopicsOutside = [],
  initialProgress,
  initialTopicProgress,
  warning,
  isIntensive,
  organizationMode = "geral",
  config,
}: PlannerClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { canAccessLessons } = useLessonsAccess();
  const { data: lessonsSummaryData } = useQuery({
    queryKey: ["lessons-summary-by-subtema"],
    queryFn: () => api.lessons.summaryBySubtema(),
    enabled: canAccessLessons,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const lessonsSummaryBySubtema = lessonsSummaryData?.subtemas;
  const [currentPlan, setCurrentPlan] = useState<PlannerWeek[]>(plan);
  const [progress, setProgress] = useState<PlannerProgressMap>(initialProgress);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [topicProgress, setTopicProgress] = useState<PlannerTopicProgressMap>(initialTopicProgress);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showInternatoModal, setShowInternatoModal] = useState(false);
  const [showCompletedOutside, setShowCompletedOutside] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [exportingIcs, setExportingIcs] = useState(false);
  const [copiedFeed, setCopiedFeed] = useState(false);

  const scheduleMode: PlannerScheduleMode = `${organizationMode === "internato" ? "internato" : "geral"}_${isIntensive ? "intensive" : "standard"}`;

  // Estados para Drag & Drop e reordenação entre semanas
  const [draggedTopic, setDraggedTopic] = useState<{ week: number; subtema: string; index: number } | null>(null);
  const [dragOverWeek, setDragOverWeek] = useState<number | null>(null);
  const [dragOverTopicIndex, setDragOverTopicIndex] = useState<{ week: number; index: number } | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [moveModalTopic, setMoveModalTopic] = useState<{ subtema: string; currentWeek: number; targetWeek: number } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPlan(plan);
    }, 0);
    return () => clearTimeout(timer);
  }, [plan]);

  const handleExportIcs = async () => {
    setExportingIcs(true);
    try {
      await api.planner.exportIcs();
      toast.success("Arquivo de calendário (.ics) gerado com sucesso!");
    } catch {
      toast.error("Erro ao exportar cronograma.");
    } finally {
      setExportingIcs(false);
    }
  };

  const handleCopyFeedUrl = async () => {
    try {
      const feedUrl = api.planner.getCalendarFeedUrl();
      await navigator.clipboard.writeText(feedUrl);
      setCopiedFeed(true);
      toast.success("URL do feed iCalendar copiada!");
      setTimeout(() => setCopiedFeed(false), 2000);
    } catch {
      toast.error("Não foi possível copiar a URL do feed.");
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setProgress(initialProgress);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialProgress]);

  useEffect(() => {
    const timer = setTimeout(() => setTopicProgress(initialTopicProgress), 0);
    return () => clearTimeout(timer);
  }, [initialTopicProgress]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showResetConfirm) setShowResetConfirm(false);
        if (showSettingsModal) setShowSettingsModal(false);
        if (showCalendarModal) setShowCalendarModal(false);
        if (showInternatoModal) setShowInternatoModal(false);
        if (moveModalTopic) setMoveModalTopic(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showResetConfirm, showSettingsModal, showCalendarModal, showInternatoModal, moveModalTopic]);

  useEffect(() => {
    const synced = (event: Event) => {
      const endpoint = (event as CustomEvent<{ endpoint?: string }>).detail?.endpoint;
      if (endpoint?.includes("/api/planner/")) router.refresh();
    };
    window.addEventListener("sync-item-success", synced);
    return () => window.removeEventListener("sync-item-success", synced);
  }, [router]);

  const handleMoveTopic = useCallback(async (
    subtema: string,
    sourceWeek: number,
    targetWeek: number,
    targetIndex?: number
  ) => {
    const sourceWeekObj = currentPlan.find(w => w.week === sourceWeek);
    const curIdx = sourceWeekObj?.topics.findIndex(t => t.subtema === subtema);

    // Evitar no-op quando solto na mesma posição dentro da mesma semana
    if (sourceWeek === targetWeek && targetIndex !== undefined && (curIdx === targetIndex || curIdx === targetIndex - 1)) {
      setDraggedTopic(null);
      setDragOverWeek(null);
      setDragOverTopicIndex(null);
      return;
    }

    const previousPlan = currentPlan;
    let topicToMove: PlannerTopic | null = null;

    // 1. Atualizar currentPlan de forma otimista
    const newPlan = currentPlan.map(w => {
      if (w.week === sourceWeek) {
        const found = w.topics.find(t => t.subtema === subtema);
        if (found) topicToMove = found;
        const filtered = w.topics.filter(t => t.subtema !== subtema);
        const allocated = filtered.reduce((acc, t) => acc + (t.estimated_hours || 0), 0);
        return {
          ...w,
          topics: filtered,
          allocated_hours: Math.round(allocated * 10) / 10
        };
      }
      return w;
    }).map(w => {
      if (w.week === targetWeek && topicToMove) {
        const updatedTopics = [...w.topics];
        if (targetIndex !== undefined && targetIndex >= 0 && targetIndex <= updatedTopics.length) {
          updatedTopics.splice(targetIndex, 0, topicToMove);
        } else {
          updatedTopics.push(topicToMove);
        }
        const allocated = updatedTopics.reduce((acc, t) => acc + (t.estimated_hours || 0), 0);
        return {
          ...w,
          topics: updatedTopics,
          allocated_hours: Math.round(allocated * 10) / 10
        };
      }
      return w;
    });

    setCurrentPlan(newPlan);

    // 2. Atualizar topicProgress se mudou de semana
    if (sourceWeek !== targetWeek) {
      setTopicProgress(prev => {
        const wasCompleted = Boolean(prev[`${sourceWeek}:${subtema}`] || prev[subtema]);
        const nextProg = { ...prev };
        delete nextProg[`${sourceWeek}:${subtema}`];
        if (wasCompleted) {
          nextProg[`${targetWeek}:${subtema}`] = true;
          nextProg[subtema] = true;
        }
        return nextProg;
      });
    }

    setDraggedTopic(null);
    setDragOverWeek(null);
    setDragOverTopicIndex(null);

    // 3. Chamada de API com tratamento offline
    try {
      setIsMoving(true);
      await api.planner.moveTopic({
        subtema,
        source_week: sourceWeek,
        target_week: targetWeek,
        target_index: targetIndex,
        mode: scheduleMode
      });
      toast.success(`"${subtema}" movido para a Semana ${targetWeek}!`);
    } catch (error) {
      if (error instanceof OfflineQueuedError) {
        toast("Alteração salva offline. Sincronizará ao reconectar.", { icon: "📶" });
        return;
      }
      setCurrentPlan(previousPlan);
      toast.error("Erro ao mover tema de semana.");
    } finally {
      setIsMoving(false);
    }
  }, [currentPlan, scheduleMode]);

  const handleDragStart = (week: number, subtema: string, index: number, e: React.DragEvent) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ week, subtema, index }));
    e.dataTransfer.effectAllowed = "move";
    setDraggedTopic({ week, subtema, index });
  };

  const handleDragEnd = () => {
    setDraggedTopic(null);
    setDragOverWeek(null);
    setDragOverTopicIndex(null);
  };

  const handleWeekDragOver = (e: React.DragEvent, weekNum: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverWeek !== weekNum) {
      setDragOverWeek(weekNum);
    }
  };

  const handleWeekDrop = (e: React.DragEvent, targetWeek: number) => {
    e.preventDefault();
    let item = draggedTopic;
    if (!item) {
      try {
        const raw = e.dataTransfer.getData("application/json");
        if (raw) item = JSON.parse(raw);
      } catch {
        // fallback
      }
    }
    if (item) {
      handleMoveTopic(item.subtema, item.week, targetWeek);
    }
    setDraggedTopic(null);
    setDragOverWeek(null);
    setDragOverTopicIndex(null);
  };

  const handleTopicDragOver = (e: React.DragEvent, weekNum: number, topicIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverTopicIndex({ week: weekNum, index: topicIdx });
  };

  const handleTopicDrop = (e: React.DragEvent, targetWeek: number, targetIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    let item = draggedTopic;
    if (!item) {
      try {
        const raw = e.dataTransfer.getData("application/json");
        if (raw) item = JSON.parse(raw);
      } catch {
        // fallback
      }
    }
    if (item) {
      handleMoveTopic(item.subtema, item.week, targetWeek, targetIdx);
    }
    setDraggedTopic(null);
    setDragOverWeek(null);
    setDragOverTopicIndex(null);
  };

  const toggleTopic = async (week: number, subtema: string, currentStatus: boolean) => {
    const key = `${week}:${subtema}`;
    const completed = !currentStatus;
    setTopicProgress(prev => {
      if (completed) {
        return { ...prev, [key]: true, [subtema]: true };
      }
      const next: PlannerTopicProgressMap = { ...prev };
      delete next[key];
      delete next[subtema];
      for (const k of Object.keys(next)) {
        if (k.endsWith(`:${subtema}`)) {
          delete next[k];
        }
      }
      return next;
    });
    try {
      await api.planner.markTopic(week, subtema, completed);
      void queryClient.invalidateQueries({ queryKey: ["planner-bundle"] });
    } catch (error) {
      if (error instanceof OfflineQueuedError) {
        toast("Alteração salva offline. Sincronizará ao reconectar.", { icon: "📶" });
        return;
      }
      setTopicProgress(prev => ({ ...prev, [key]: currentStatus, [subtema]: currentStatus }));
      toast.error("Erro ao salvar o tema concluído.");
    }
  };

  const handleResetScope = async (scope: "schedule" | "progress" | "all") => {
    setShowResetConfirm(false);
    setLoadingAction("reset");
    try {
      await api.planner.resetConfig({
        scope,
        mode: scope === "schedule" ? scheduleMode : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["planner-bundle"] });
      if (scope === "schedule") {
        toast.success("Cronograma reorganizado mantendo suas aulas feitas!");
      } else if (scope === "progress") {
        toast.success("Aulas concluídas zeradas com sucesso.");
      } else {
        toast.success("Planner reiniciado por completo.");
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao reiniciar planner.";
      toast.error(message);
    } finally {
      setLoadingAction(null);
    }
  };

  const buildPlannerUrl = (intensiveVal: boolean, orgVal: PlannerOrganizationMode) => {
    const params = new URLSearchParams();
    if (intensiveVal) params.set("intensive", "true");
    params.set("org", orgVal);
    return `/planner?${params.toString()}`;
  };

  const handleToggleIntensive = () => {
    router.push(buildPlannerUrl(!isIntensive, organizationMode));
  };

  const handleSwitchOrganization = async (nextOrg: PlannerOrganizationMode) => {
    if (nextOrg === organizationMode || switchingOrg) return;
    setSwitchingOrg(true);
    try {
      if (config) {
        await api.planner.saveConfig({
          exam_date: config.exam_date,
          start_date: config.start_date,
          days_per_week: config.days_per_week,
          hours_per_day: config.hours_per_day,
          target_score: config.target_score,
          target_institution: config.target_institution,
          target_institutions: config.target_institutions,
          target_specialty: config.target_specialty,
          organization_mode: nextOrg,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["planner-bundle"] });
      router.push(buildPlannerUrl(Boolean(isIntensive), nextOrg));
    } catch {
      toast.error("Erro ao trocar modo de organização.");
    } finally {
      setSwitchingOrg(false);
    }
  };

  const handleToggleStudy = async (week: number, currentStatus: boolean) => {
    const actionKey = `study-${week}`;
    if (loadingAction) return;
    setLoadingAction(actionKey);

    const newStatus = !currentStatus;
    // Optimistic UI
    setProgress(prev => ({
      ...prev,
      [week.toString()]: { ...prev[week.toString()], studied: newStatus, studied_at: newStatus ? new Date().toISOString() : null }
    }));

    try {
      await api.planner.markStudy(week, newStatus);
    } catch (error) {
      if (error instanceof OfflineQueuedError) {
        toast("Status salvo offline. Sincronizará ao reconectar.", { icon: "📶" });
        return;
      }
      toast.error("Erro ao salvar progresso.");
      // Revert on error
      setProgress(prev => ({
        ...prev,
        [week.toString()]: {
          ...prev[week.toString()],
          studied: currentStatus,
          studied_at: currentStatus ? prev[week.toString()]?.studied_at ?? null : null,
        }
      }));
    } finally {
      setLoadingAction(null);
    }
  };

  const today = new Date();
  const visibleCompletedOutside = completedTopicsOutside.filter(
    (t) => topicProgress[t.subtema] !== false
  );
  const scheduledTopicsCount = currentPlan.reduce((total, week) => total + week.topics.length, 0);
  const completedInScheduleCount = currentPlan.reduce(
    (total, week) =>
      total +
      week.topics.filter(
        (t) => Boolean(topicProgress[`${week.week}:${t.subtema}`]) || Boolean(topicProgress[t.subtema])
      ).length,
    0
  );
  const totalTopics = scheduledTopicsCount + visibleCompletedOutside.length;
  const completedTopics = completedInScheduleCount + visibleCompletedOutside.length;
  const defaultWeeklyHours = Math.min(168, (config?.days_per_week || 6) * (config?.hours_per_day || 2));

  return (
    <>
    <div className="flex flex-col gap-6 pb-12">
      {warning && !isIntensive && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-4 rounded-xl flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex gap-3">
            <AlertTriangle className="shrink-0 mt-0.5" size={20} />
            <div>
              <p className="font-semibold text-sm">Alerta de Tempo</p>
              <p className="text-sm opacity-90">{warning}</p>
            </div>
          </div>
          <button 
            onClick={handleToggleIntensive}
            className="shrink-0 bg-amber-500 text-white font-medium px-4 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-amber-600 transition-colors"
          >
            <Zap size={16} /> Ativar Plano Intensivo
          </button>
        </div>
      )}

      {isIntensive && (
        <div className="bg-primary/10 border border-primary/20 text-primary p-4 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="shrink-0" size={20} />
            <p className="text-sm font-medium">Modo Intensivo Ativado: Exibindo apenas temas de Alto Rendimento.</p>
          </div>
          <button 
            onClick={handleToggleIntensive}
            className="text-xs font-medium hover:underline opacity-80"
          >
            Voltar ao plano normal
          </button>
        </div>
      )}

      <div className="mq-page-hero p-5 sm:p-6 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between mb-2 gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-ink-primary flex items-center gap-2">
            <CalendarDays className="text-accent" size={28} />
            Seu Cronograma de Estudos
          </h2>
          <p className="text-ink-secondary text-sm">Cronograma estruturado por carga, cobertura e temas de alta incidência. Arraste matérias para mover entre semanas.</p>
          {config?.target_institution && (
            <div className="flex items-center gap-1.5 text-xs text-ink-secondary mt-1.5 flex-wrap">
              {config.target_institution.split(",").map((instName, idx) => (
                <span key={idx} className="font-bold bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-md">
                  {instName.trim()}
                </span>
              ))}
              {config.target_specialty && (
                <>
                  <span>•</span>
                  <span><strong className="text-ink-primary">Especialidade:</strong> {config.target_specialty}</span>
                </>
              )}
              {config.target_score && (
                <>
                  <span>•</span>
                  <span><strong className="text-ink-primary">Meta:</strong> {config.target_score}%</span>
                </>
              )}
              {config.days_per_week && config.hours_per_day && (
                <>
                  <span>•</span>
                  <span>{config.days_per_week} dias/sem ({config.hours_per_day}h/dia)</span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto flex-wrap justify-between sm:justify-end">
          <div className="flex-1 sm:w-44">
            <div className="flex justify-between text-[11px] uppercase tracking-wider font-semibold mb-1">
              <span className="text-ink-muted">Temas concluídos</span>
              <span className="text-primary">{completedTopics} / {totalTopics}</span>
            </div>
            <div className="h-2 w-full bg-elevated rounded-full overflow-hidden ring-1 ring-inset ring-black/5 dark:ring-white/5">
              <div 
                className="h-full bg-primary transition-all duration-500 shadow-inner" 
                style={{ width: `${(completedTopics / Math.max(1, totalTopics)) * 100}%` }}
              />
            </div>
          </div>
          <div
            role="group"
            aria-label="Organização do cronograma"
            className="inline-flex items-center rounded-lg border border-line-subtle bg-elevated p-0.5 shadow-sm"
          >
            <button
              type="button"
              disabled={switchingOrg}
              onClick={() => void handleSwitchOrganization("geral")}
              aria-pressed={organizationMode === "geral"}
              className={clsx(
                "flex items-center gap-1.5 min-h-[34px] text-xs font-semibold px-2.5 py-1 rounded-md transition-colors cursor-pointer",
                organizationMode === "geral"
                  ? "bg-surface text-primary shadow-2xs"
                  : "text-ink-secondary hover:text-ink-primary"
              )}
            >
              <Layers size={14} />
              Geral (Misturado)
            </button>
            <button
              type="button"
              disabled={switchingOrg}
              onClick={() => void handleSwitchOrganization("internato")}
              aria-pressed={organizationMode === "internato"}
              className={clsx(
                "flex items-center gap-1.5 min-h-[34px] text-xs font-semibold px-2.5 py-1 rounded-md transition-colors cursor-pointer",
                organizationMode === "internato"
                  ? "bg-surface text-primary shadow-2xs"
                  : "text-ink-secondary hover:text-ink-primary"
              )}
            >
              <CalendarRange size={14} />
              Por Bloco do Internato
            </button>
          </div>
          {organizationMode === "internato" && (
            <button
              type="button"
              onClick={() => setShowInternatoModal(true)}
              aria-haspopup="dialog"
              aria-expanded={showInternatoModal}
              className="flex items-center gap-1.5 min-h-[38px] text-xs sm:text-sm font-semibold text-ink-primary bg-surface hover:bg-elevated border border-line-subtle px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
              title="Editar datas e áreas dos rodízios do internato"
            >
              <CalendarRange size={15} className="text-primary" />
              Blocos
            </button>
          )}
          <button
            type="button"
            onClick={handleToggleIntensive}
            aria-pressed={isIntensive}
            title="Filtrar o cronograma para exibir apenas temas prioritários de alta incidência"
            className={`flex items-center gap-1.5 min-h-[38px] text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-lg border transition-colors shadow-sm cursor-pointer ${
              isIntensive
                ? "bg-warning/15 text-warning border-warning/40"
                : "bg-surface text-ink-primary border-line-subtle hover:bg-elevated"
            }`}
          >
            <Zap size={15} />
            {isIntensive ? "Reta Final: Ativa" : "Modo Reta Final"}
          </button>
          <button 
            type="button"
            onClick={() => setShowSettingsModal(true)}
            aria-haspopup="dialog"
            aria-expanded={showSettingsModal}
            className="flex items-center gap-1.5 min-h-[38px] text-xs sm:text-sm font-semibold text-primary bg-primary/10 hover:bg-primary/20 border border-primary/25 px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
          >
            <Settings2 size={15} />
            Calibrar Perfil
          </button>
          <button 
            type="button"
            onClick={() => setShowCalendarModal(true)}
            aria-haspopup="dialog"
            aria-expanded={showCalendarModal}
            className="flex items-center gap-1.5 min-h-[38px] text-xs sm:text-sm font-medium text-ink-primary bg-elevated hover:bg-elevated/80 px-2.5 py-1.5 rounded-lg border border-line-subtle transition-colors shadow-sm cursor-pointer"
            title="Sincronizar cronograma com Google Agenda, Apple Calendar ou baixar arquivo .ics"
          >
            <CalendarDays size={15} className="text-primary" />
            Sincronizar com Agenda
          </button>
          <button 
            type="button"
            onClick={() => setShowResetConfirm(true)}
            disabled={loadingAction === "reset"}
            aria-haspopup="dialog"
            aria-expanded={showResetConfirm}
            className="flex items-center gap-1.5 min-h-[38px] text-xs sm:text-sm font-medium text-ink-secondary hover:text-ink-primary bg-elevated hover:bg-elevated/80 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            {loadingAction === "reset" ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
            Refazer
          </button>
        </div>
      </div>

      {visibleCompletedOutside.length > 0 && (
        <div className="bg-surface border border-line-subtle rounded-xl overflow-hidden shadow-1">
          <button
            type="button"
            onClick={() => setShowCompletedOutside((prev) => !prev)}
            aria-expanded={showCompletedOutside}
            className="w-full px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-elevated/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5 text-left">
              <CheckCircle2 size={18} className="text-success shrink-0" />
              <div>
                <span className="text-sm font-bold text-ink-primary">
                  Temas já concluídos ({visibleCompletedOutside.length})
                </span>
                <p className="text-xs text-ink-secondary">
                  Mantidos fora das semanas futuras para não poluir sua carga semanal pendente.
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-secondary shrink-0">
              {showCompletedOutside ? "Recolher" : "Ver lista"}
              {showCompletedOutside ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </span>
          </button>
          {showCompletedOutside && (
            <div className="px-5 pb-4 pt-1 border-t border-line-subtle divide-y divide-line-subtle/60">
              {visibleCompletedOutside.map((t) => (
                <div key={t.subtema} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-muted-foreground line-through block truncate">
                      {t.subtema}
                    </span>
                    <span className={clsx("text-xs font-medium", getAreaColorClass(t.area).split(" ")[1])}>
                      {t.area}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleTopic(0, t.subtema, true)}
                    className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-md border border-line-subtle bg-elevated hover:bg-elevated/80 text-ink-secondary hover:text-ink-primary transition-colors cursor-pointer"
                    title="Desmarcar conclusão (reorganize o cronograma para reagendar)"
                  >
                    Desmarcar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {currentPlan.map((week) => {
          const weekProgress = progress[week.week.toString()] || { studied: false, rev24h: false, rev7d: false, rev30d: false };
          const completedInWeek = week.topics.filter(topic => topicProgress[`${week.week}:${topic.subtema}`] || topicProgress[topic.subtema]).length;
          const weekDate = new Date(`${week.date.slice(0, 10)}T12:00:00`);
          // Highlight current week if it falls within this week's 7 days
          const isCurrentWeek = weekDate <= today && new Date(weekDate.getTime() + 7 * 24 * 60 * 60 * 1000) > today;
          const isOverloaded = week.allocated_hours > week.recommended_hours + 1.0;
          const isOverDropWeek = dragOverWeek === week.week;

          return (
            <div 
              key={week.week} 
              onDragOver={(e) => handleWeekDragOver(e, week.week)}
              onDrop={(e) => handleWeekDrop(e, week.week)}
              className={clsx(
                "bg-surface border rounded-xl overflow-hidden shadow-1 flex flex-col md:flex-row transition-all",
                isOverDropWeek ? "border-primary ring-2 ring-primary/40 bg-primary/[0.02]" :
                isCurrentWeek ? "border-primary ring-1 ring-primary/20" : "border-line-subtle",
                weekProgress.studied ? "opacity-75" : "opacity-100"
              )}
            >
              {/* Left Column (Info) */}
              <div className="p-5 flex-1 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-bold text-ink-secondary bg-elevated px-2.5 py-1 rounded-md">
                      Semana {week.week}
                    </span>
                    {organizationMode === "internato" && week.internato_block_label && (
                      <span className="text-xs font-semibold text-primary bg-primary/10 border border-primary/20 px-2.5 py-0.5 rounded-full">
                        {week.internato_block_label}
                      </span>
                    )}
                    <span className="text-sm text-ink-secondary flex items-center gap-2">
                      {weekDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                      <span className={clsx(
                        "text-xs px-2 py-0.5 rounded-full font-medium transition-colors",
                        isOverloaded 
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold" 
                          : "bg-elevated text-ink-secondary"
                      )}>
                       {week.allocated_hours}h / {week.recommended_hours}h
                      </span>
                    </span>
                    {isCurrentWeek && (
                      <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Activity size={12} /> Atual
                      </span>
                    )}
                    <span className="text-xs text-ink-muted">{completedInWeek}/{week.topics.length} temas</span>
                  </div>
                </div>

                <div className="flex flex-col gap-3 min-h-[40px]">
                  {week.topics.map((t, idx) => (
                    <TopicRow 
                      key={t.subtema} 
                      t={t} 
                      completed={Boolean(topicProgress[`${week.week}:${t.subtema}`]) || Boolean(topicProgress[t.subtema])}
                      toggleTopic={toggleTopic}
                      week={week.week}
                      isDragging={draggedTopic?.subtema === t.subtema}
                      isDragOverBefore={dragOverTopicIndex?.week === week.week && dragOverTopicIndex?.index === idx && draggedTopic?.subtema !== t.subtema}
                      onDragStart={(e) => handleDragStart(week.week, t.subtema, idx, e)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleTopicDragOver(e, week.week, idx)}
                      onDrop={(e) => handleTopicDrop(e, week.week, idx)}
                      onOpenMoveModal={() => setMoveModalTopic({ subtema: t.subtema, currentWeek: week.week, targetWeek: week.week })}
                      lessonSummary={canAccessLessons ? lessonsSummaryBySubtema?.[t.subtema] : undefined}
                    />
                  ))}
                  {week.topics.length === 0 && (
                    <div 
                      onDragOver={(e) => handleWeekDragOver(e, week.week)}
                      onDrop={(e) => handleWeekDrop(e, week.week)}
                      className={clsx(
                        "py-7 px-4 border-2 border-dashed rounded-xl text-center transition-all flex flex-col items-center justify-center gap-1.5",
                        isOverDropWeek 
                          ? "border-primary bg-primary/10 text-primary scale-[1.01]" 
                          : "border-line-subtle text-ink-muted bg-elevated/10 hover:border-primary/40"
                      )}
                    >
                      <CalendarDays size={20} className="opacity-60" />
                      <span className="text-xs font-semibold">Semana sem matérias (descanso ou revisão)</span>
                      <span className="text-[11px] opacity-75">Arraste temas para cá para agendar nesta semana.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column (Checklist) */}
              <div className="bg-canvas/60 p-5 border-t md:border-t-0 md:border-l border-line-subtle md:w-72 shrink-0 flex flex-col justify-center">
                <h3 className="text-sm font-semibold text-ink-primary mb-2 uppercase tracking-wider">Status da semana</h3>
                <p className="text-xs text-ink-muted mb-4">As revisões espaçadas de questões são gerenciadas pelo FSRS.</p>
                <div className="flex flex-col gap-3">
                  
                  {/* Master Study Checkbox */}
                  <label className={clsx(
                    "flex items-center gap-3 p-2.5 min-h-[38px] rounded-lg cursor-pointer transition-colors border",
                    weekProgress.studied ? "bg-primary/10 border-primary/20" : "bg-surface border-line-subtle hover:bg-elevated"
                  )}>
                    <div className="relative flex items-center">
                      <input 
                        type="checkbox"
                        className="peer sr-only"
                        checked={weekProgress.studied}
                        onChange={() => handleToggleStudy(week.week, weekProgress.studied)}
                        disabled={loadingAction === `study-${week.week}`}
                        aria-label={`Concluir semana ${week.week}`}
                      />
                      <div className="w-5 h-5 border-2 border-ink-muted rounded transition-colors peer-checked:bg-primary peer-checked:border-primary flex items-center justify-center">
                        {loadingAction === `study-${week.week}` ? (
                          <Loader2 size={12} className="text-primary-foreground animate-spin" />
                        ) : (
                          <Check size={14} className={clsx("text-primary-foreground transition-opacity", weekProgress.studied ? "opacity-100" : "opacity-0")} strokeWidth={3} />
                        )}
                      </div>
                    </div>
                    <span className={clsx("text-sm font-medium select-none", weekProgress.studied ? "text-primary" : "text-ink-primary")}>
                      Fechar semana
                    </span>
                  </label>


                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowResetConfirm(false)} />
          <div 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="reset-modal-title"
            className="relative bg-surface border border-line-subtle rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4 animate-in fade-in zoom-in-95 duration-200 z-10"
          >
            <button 
              type="button"
              onClick={() => setShowResetConfirm(false)} 
              aria-label="Fechar modal de confirmação"
              className="absolute top-3.5 right-3.5 p-1.5 min-w-[38px] min-h-[38px] flex items-center justify-center rounded-full hover:bg-elevated transition-colors text-ink-muted cursor-pointer"
            >
              <X size={18} />
            </button>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500/10 rounded-full shrink-0">
                  <RotateCcw size={22} className="text-amber-500" />
                </div>
                <div>
                  <h3 id="reset-modal-title" className="text-lg font-bold text-ink-primary">Refazer ou Resetar Planner</h3>
                  <p className="text-xs text-ink-secondary">Escolha o que deseja reiniciar:</p>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleResetScope("schedule")}
                  className="w-full text-left p-3.5 rounded-xl border border-line-subtle bg-elevated/60 hover:bg-elevated hover:border-primary/40 transition-colors cursor-pointer"
                >
                  <p className="text-sm font-bold text-ink-primary">Reorganizar cronograma atual</p>
                  <p className="text-xs text-ink-secondary mt-0.5">
                    Recalcula a distribuição das semanas mantendo todas as aulas já marcadas como feitas.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => void handleResetScope("progress")}
                  className="w-full text-left p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition-colors cursor-pointer"
                >
                  <p className="text-sm font-bold text-amber-600 dark:text-amber-400">Zerar aulas concluídas</p>
                  <p className="text-xs text-ink-secondary mt-0.5">
                    Desmarca todas as aulas feitas e revisões, mantendo suas datas, horas e blocos do internato.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => void handleResetScope("all")}
                  className="w-full text-left p-3.5 rounded-xl border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-colors cursor-pointer"
                >
                  <p className="text-sm font-bold text-destructive">Reset completo</p>
                  <p className="text-xs text-ink-secondary mt-0.5">
                    Apaga configurações, blocos e todo o progresso para recomeçar do zero.
                  </p>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="w-full py-2.5 px-4 min-h-[38px] rounded-xl border border-line-subtle text-ink-primary hover:bg-elevated transition-colors font-medium text-sm cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showInternatoModal && (
        <InternatoBlocksModal
          initialBlocks={config?.internato_blocks || []}
          defaultWeeklyHours={defaultWeeklyHours}
          onClose={() => setShowInternatoModal(false)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ["planner-bundle"] });
            router.refresh();
          }}
        />
      )}

      {/* Settings / Calibration Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSettingsModal(false)} />
          <div 
            role="dialog" 
            aria-modal="true" 
            aria-label="Calibrar Perfil de Estudos"
            className="relative z-10 max-h-[90dvh] overflow-y-auto w-full max-w-2xl animate-in fade-in zoom-in-95 duration-200"
          >
            <PlannerWizard
              initialConfig={config}
              onClose={() => setShowSettingsModal(false)}
              isModal
            />
          </div>
        </div>
      )}

      {/* Calendar Export Modal (.ics + iCalendar Feed) */}
      {showCalendarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCalendarModal(false)} />
          <div 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="calendar-modal-title"
            className="relative bg-surface border border-line-subtle rounded-lg shadow-2xl p-6 max-w-lg w-full max-h-[90dvh] overflow-y-auto z-10"
          >
            <button 
              type="button"
              onClick={() => setShowCalendarModal(false)} 
              aria-label="Fechar modal de exportação"
              className="absolute top-3.5 right-3.5 p-1.5 min-w-[38px] min-h-[38px] flex items-center justify-center rounded-md hover:bg-elevated transition-colors text-ink-muted cursor-pointer"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-accent/15 text-accent rounded-md flex items-center justify-center border border-accent/20 shrink-0">
                <CalendarDays size={20} />
              </div>
              <div>
                <h3 id="calendar-modal-title" className="text-lg font-bold text-ink-primary">Exportar Cronograma (.ics)</h3>
                <p className="text-xs text-ink-secondary">Compatível com Google Agenda, Apple Calendar e Outlook.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="border border-line-subtle bg-canvas rounded-lg p-4 space-y-3">
                <p className="text-xs text-ink-secondary leading-relaxed">
                  Baixe o arquivo padrão <strong className="text-ink-primary">.ics</strong> com todos os blocos semanais de estudo e importe diretamente no aplicativo de agenda da sua preferência.
                </p>

                <button
                  type="button"
                  onClick={handleExportIcs}
                  disabled={exportingIcs}
                  className="w-full bg-accent hover:bg-accent/90 text-white font-semibold py-2.5 px-4 min-h-[38px] rounded-md transition-colors flex items-center justify-center gap-2 text-xs disabled:opacity-50 cursor-pointer"
                >
                  {exportingIcs ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {exportingIcs ? "Gerando arquivo .ics..." : "Baixar Arquivo .ics do Cronograma"}
                </button>
              </div>

              <div className="border border-line-subtle bg-canvas rounded-lg p-4 space-y-2.5">
                <div className="text-xs font-bold text-ink-primary">Assinatura Automática (Feed iCalendar)</div>
                <p className="text-[11px] text-ink-secondary leading-relaxed">
                  Copie a URL do feed para assinar seu cronograma por link no Apple Calendar, Outlook ou Google Agenda.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    aria-label="URL do feed iCalendar"
                    value={api.planner.getCalendarFeedUrl()}
                    className="flex-1 bg-surface border border-line-subtle rounded-md px-2.5 py-1.5 text-[11px] font-mono-lab text-ink-muted focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyFeedUrl}
                    className="px-3 py-1.5 min-h-[36px] rounded-md border border-line-subtle bg-surface hover:bg-elevated text-xs font-semibold text-ink-primary inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    {copiedFeed ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                    {copiedFeed ? "Copiado" : "Copiar"}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 text-[11px] text-ink-secondary flex items-start gap-2 bg-canvas p-3 rounded-md border border-line-subtle">
              <Lightbulb size={14} className="text-accent shrink-0 mt-0.5" />
              <span>
                Após importar o arquivo <strong>.ics</strong> na sua agenda, os eventos passam a ser 100% editáveis no seu calendário pessoal.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Accessible & Mobile Move Modal */}
      {moveModalTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMoveModalTopic(null)} />
          <div 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="move-modal-title"
            className="relative bg-surface border border-line-subtle rounded-2xl shadow-2xl p-6 max-w-sm w-full z-10 animate-in fade-in zoom-in-95 duration-200"
          >
            <button 
              type="button"
              onClick={() => setMoveModalTopic(null)} 
              aria-label="Fechar"
              className="absolute top-3.5 right-3.5 p-1.5 min-w-[38px] min-h-[38px] flex items-center justify-center rounded-full hover:bg-elevated transition-colors text-ink-muted cursor-pointer"
            >
              <X size={18} />
            </button>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center border border-primary/20 shrink-0">
                  <ArrowUpDown size={20} />
                </div>
                <div>
                  <h3 id="move-modal-title" className="text-base font-bold text-ink-primary">Mover Tema</h3>
                  <p className="text-xs text-ink-secondary">Escolha a semana de destino</p>
                </div>
              </div>

              <div className="bg-elevated/40 border border-line-subtle rounded-xl p-3">
                <span className="text-xs font-semibold text-ink-primary block truncate" title={moveModalTopic.subtema}>
                  {moveModalTopic.subtema}
                </span>
                <span className="text-[11px] text-ink-secondary mt-0.5 block">
                  Semana atual: <strong className="text-ink-primary">Semana {moveModalTopic.currentWeek}</strong>
                </span>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="target-week-select" className="text-xs font-semibold text-ink-primary">
                  Mover para:
                </label>
                <select
                  id="target-week-select"
                  value={moveModalTopic.targetWeek}
                  onChange={(e) => setMoveModalTopic(prev => prev ? { ...prev, targetWeek: Number(e.target.value) } : null)}
                  className="w-full bg-canvas border border-line-subtle rounded-xl px-3 py-2.5 text-xs text-ink-primary focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
                >
                  {currentPlan.map((w) => {
                    const wDate = new Date(`${w.date.slice(0, 10)}T12:00:00`);
                    return (
                      <option key={w.week} value={w.week}>
                        Semana {w.week} ({wDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}) • {w.topics.length} temas ({w.allocated_hours}h/{w.recommended_hours}h)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button 
                  type="button"
                  onClick={() => setMoveModalTopic(null)} 
                  className="flex-1 py-2 px-3 min-h-[38px] rounded-xl border border-line-subtle text-ink-primary hover:bg-elevated text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  type="button"
                  disabled={isMoving}
                  onClick={async () => {
                    const { subtema, currentWeek, targetWeek } = moveModalTopic;
                    setMoveModalTopic(null);
                    await handleMoveTopic(subtema, currentWeek, targetWeek);
                  }} 
                  className="flex-1 py-2 px-3 min-h-[38px] rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {isMoving ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

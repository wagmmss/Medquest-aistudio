"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { QuestionMeta, QuestionListItem, QuestionDetail, AttemptResult } from "@/types/api";
import { api, AttemptPayload, OfflineQueuedError } from "@/lib/api";
import { invalidateStudyCaches, useQuestionMetaQuery } from "@/lib/queries/useStudyQueries";
import { Clock, CheckCircle2, BookOpen, ArrowRight, ImageOff, AlertTriangle, CloudOff, RotateCcw, Pencil, Eye, EyeOff, Target, Lightbulb, Loader2, PlayCircle } from "lucide-react";
import clsx from "clsx";
import toast from "react-hot-toast";
import { isLocalIdentityReady } from "@/lib/db";
import { prefetchQuestionsByIds, getCachedQuestionsMap } from "@/lib/syncQueue";
import { useAppUser } from "@/lib/auth-client";
import { areFiltersEquivalent } from "@/lib/quizFilterMatch";
import { buildLessonReturnUrl } from "@/lib/themeJourney";
import type { LessonCycleQuizContext } from "./components/QuizSessionReportModal";

import dynamic from "next/dynamic";
import { FormattedContent, normalizeImageSrc, filterExtraImages } from "@/components/FormattedContent";

const ImageViewer = dynamic(
  () => import("@/components/ImageViewer").then((mod) => mod.ImageViewer),
  { ssr: false }
);
const ExplanationViewer = dynamic(
  () => import("@/components/ExplanationViewer").then((mod) => mod.ExplanationViewer),
  {
    ssr: false,
    loading: () => <div className="h-32 w-full rounded-xl bg-surface-subtle animate-pulse" />,
  }
);
const QuestionClassificationModal = dynamic(
  () => import("@/components/QuestionClassificationModal").then((mod) => mod.QuestionClassificationModal),
  { ssr: false }
);
import { useZenMode } from "@/hooks/useZenMode";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useCurator } from "@/hooks/useCurator";
import type { QuizTimerHandle } from "@/components/QuizTimer";
import Image from "next/image";
import { QuizFilters } from "./components/QuizFilters";
import { AlternativeList } from "./components/AlternativeList";
import { AlternativeContent } from "@/components/AlternativeContent";
import { PreceptorSection, ChatMessage } from "./components/PreceptorSection";
import { QuizHeader, StemFontSize } from "./components/QuizHeader";

const LabValuesModal = dynamic(
  () => import("@/components/LabValuesModal").then((mod) => mod.LabValuesModal),
  { ssr: false }
);
import { QuizLoadingView } from "./components/QuizSummaryView";
const QuizSummaryView = dynamic(
  () => import("./components/QuizSummaryView").then((mod) => mod.QuizSummaryView),
  { loading: () => <QuizLoadingView /> }
);
import { DiscursiveAssessmentSection } from "./components/DiscursiveAssessmentSection";
import { QuestionNotePanel } from "@/components/QuestionNotePanel";
import { buildAnkiCardFromQuestion, sendCardToAnki } from "@/lib/ankiExport";
import { SessionAnswer as _SessionAnswer, QuizState } from "./quizSessionReducer";
export type SessionAnswer = _SessionAnswer;
import {
  LEARNING_SESSION_VERSION,
  readLearningSession,
  removeLearningSession,
  writeLearningSession,
} from "@/lib/sessionState";
import { useQuizKeyboard } from "./hooks/useQuizKeyboard";
import { ClinicalIcon } from "@/components/ui/ClinicalIcon";

const EMPTY_ELIMINATED: string[] = [];

function warmQuestionImages(detail?: QuestionDetail | null): void {
  if (typeof window === "undefined" || !detail) return;
  const rawImages = [
    ...(Array.isArray(detail.images) ? detail.images : []),
    ...(Array.isArray(detail.clinical_case?.images) ? detail.clinical_case.images : []),
  ];
  for (const raw of rawImages) {
    if (!raw || typeof raw !== "string") continue;
    try {
      const img = new window.Image();
      img.decoding = "async";
      img.src = normalizeImageSrc(raw);
    } catch {
      // Ignora falha de preload de imagem em segundo plano
    }
  }
}

function formatReviewDatePtBr(dateStr?: string | null): string {
  if (!dateStr) return "Em breve";
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return "Em breve";
  return parsed.toLocaleDateString("pt-BR");
}

export interface SavedQuizState {
  version: number;
  state: "PLAYING" | "FINISHED";
  queue: QuestionListItem[];
  currentIndex: number;
  filters: Record<string, string | string[]>;
  currentDetail: QuestionDetail | null;
  sessionAnswers: Record<number, SessionAnswer>;
  selectedLetter: string | null;
  userWrittenAnswer?: string;
  attendingTip?: string | null;
  attendingTipsByQid?: Record<number, string>;
  timeSpent: number;
  savedAt: number;
  eliminatedAlternatives?: Record<number, string[]>;
  pendingSubmits?: Record<number, { key: string; body: AttemptPayload }>;
}

function isSavedQuizState(value: unknown): value is SavedQuizState {
  if (typeof value !== "object" || value === null) return false;
  const saved = value as Partial<SavedQuizState>;
  return saved.version === LEARNING_SESSION_VERSION &&
    (saved.state === "PLAYING" || saved.state === "FINISHED") &&
    Array.isArray(saved.queue) && saved.queue.length > 0 &&
    typeof saved.currentIndex === "number" && saved.currentIndex >= 0 &&
    saved.currentIndex < saved.queue.length &&
    typeof saved.filters === "object" && saved.filters !== null &&
    typeof saved.sessionAnswers === "object" && saved.sessionAnswers !== null;
}

const DEFAULT_META: QuestionMeta = {
  total_questions: 0,
  answered_questions: 0,
  institutions: [],
  years: [],
  areas: [],
  subtemas: [],
  sources: [],
  specialties: []
};

export function QuizClient({
  meta = DEFAULT_META,
  initialFilters = {}
}: {
  meta?: QuestionMeta;
  initialFilters?: Record<string, string | string[]>;
}) {
  const { isLoaded: authLoaded } = useAppUser();
  const { isCurator } = useCurator();
  const [isClassificationModalOpen, setIsClassificationModalOpen] = useState(false);
  const hasExplicitFilters = Object.keys(initialFilters).filter(k => k !== "resume").length > 0;
  const [state, setState] = useState<QuizState>(hasExplicitFilters ? "LOADING_QUEUE" : "FILTERS");
  const [filters, setFilters] = useState<Record<string, string | string[]>>({ limit: "50", status: "unanswered", unanswered_only: "true", ...initialFilters });
  const [localLimit, setLocalLimit] = useState<string>(
    typeof filters.limit === "string" ? filters.limit : "50"
  );
  const { isZenMode: zenMode, toggleZenMode } = useZenMode();
  const [subtemaSearch, setSubtemaSearch] = useState("");
  const [showCustomSession, setShowCustomSession] = useState(true);
  const [showTopicTree, setShowTopicTree] = useState(false);
  const [hasSavedState, setHasSavedState] = useState(false);
  const [savedSessionData, setSavedSessionData] = useState<SavedQuizState | null>(null);

  const [showTopic, setShowTopic] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("medquest_show_topic");
      if (saved !== null) {
        return saved === "true";
      }
    }
    return false;
  });

  const toggleTopic = useCallback(() => {
    setShowTopic(prev => {
      const next = !prev;
      localStorage.setItem("medquest_show_topic", String(next));
      return next;
    });
  }, []);
  const queryClient = useQueryClient();
  const { data: queriedMeta, isFetching: isUpdatingMeta } = useQuestionMetaQuery(
    filters,
    state === "FILTERS",
    meta || DEFAULT_META
  );
  const dynamicMeta = queriedMeta ?? meta ?? DEFAULT_META;
  
  const [queue, setQueue] = useState<QuestionListItem[]>([]);
  const queueRef = useRef<QuestionListItem[]>([]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentDetail, setCurrentDetail] = useState<QuestionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  
  const [sessionAnswers, setSessionAnswers] = useState<Record<number, SessionAnswer>>({});
  useWakeLock(!!currentDetail && !loadingDetail);
  
  // Quiz State
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [eliminatedAlternatives, setEliminatedAlternatives] = useState<Record<number, string[]>>({});
  const [userWrittenAnswer, setUserWrittenAnswer] = useState<string>("");
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null);
  const [isOfflineSaved, setIsOfflineSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [askingPreceptor, setAskingPreceptor] = useState(false);
  const [preceptorInput, setPreceptorInput] = useState("");
  
  // Timer State
  const quizTimerRef = useRef<QuizTimerHandle>(null);
  const [initialTime, setInitialTime] = useState(0);

  // Expose current time without causing re-renders
  const getCurrentTime = useCallback(() => quizTimerRef.current?.getTime() ?? initialTime, [initialTime]);
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [labsOpen, setLabsOpen] = useState(false);
  const [attendingTip, setAttendingTip] = useState<string | null>(null);
  const [loadingTip, setLoadingTip] = useState(false);
  const [stemFontSize, setStemFontSize] = useState<StemFontSize>(() => {
    if (typeof window === "undefined") return "md";
    const saved = window.localStorage.getItem("medquest:stem-font-size");
    return saved === "sm" || saved === "lg" ? saved : "md";
  });

  const cycleFontSize = useCallback(() => {
    setStemFontSize((prev) => {
      const next: StemFontSize = prev === "md" ? "lg" : prev === "lg" ? "sm" : "md";
      if (typeof window !== "undefined") {
        window.localStorage.setItem("medquest:stem-font-size", next);
      }
      return next;
    });
  }, []);

  const detailsCacheRef = useRef<Record<number, QuestionDetail>>({});
  const prefetchingRef = useRef<Set<number>>(new Set());

  const [togglingFavorite, setTogglingFavorite] = useState(false);
  const detailRequestRef = useRef(0);
  const queueRequestRef = useRef(0);
  // Envios de tentativa em voo, por questão. Um booleano global travava a sessão
  // inteira quando o aluno navegava durante o envio (o finally só liberava se
  // ainda estivesse na mesma questão) e permitia um 2º envio ao voltar.
  const inFlightAttemptsRef = useRef<Set<number>>(new Set());
  const [pendingSubmits, setPendingSubmits] = useState<Record<number, { key: string; body: AttemptPayload }>>({});
  const pendingSubmitsRef = useRef<Record<number, { key: string; body: AttemptPayload }>>({});
  const reviewLockRef = useRef(false);
  const favoriteLockRef = useRef(false);
  const reviewedQuestionsRef = useRef<Set<number>>(new Set());

  const currentIndexRef = useRef(currentIndex);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const sessionAnswersRef = useRef(sessionAnswers);
  useEffect(() => {
    sessionAnswersRef.current = sessionAnswers;
  }, [sessionAnswers]);

  const attendingTipRef = useRef(attendingTip);
  useEffect(() => {
    attendingTipRef.current = attendingTip;
  }, [attendingTip]);

  const attendingTipsByQidRef = useRef<Record<number, string>>({});
  const chatMessagesByQidRef = useRef<Record<number, ChatMessage[]>>({});
  const draftWrittenByQidRef = useRef<Record<number, string>>({});
  const draftSelectedByQidRef = useRef<Record<number, string | null>>({});
  const timeSpentByQidRef = useRef<Record<number, number>>({});

  const currentDetailRef = useRef(currentDetail);
  const attemptResultRef = useRef(attemptResult);
  useEffect(() => {
    currentDetailRef.current = currentDetail;
    attemptResultRef.current = attemptResult;
  }, [currentDetail, attemptResult]);

  const handleRequestAttendingTip = useCallback(async () => {
    if (!currentDetail || loadingTip || attendingTip) return;
    const targetQid = currentDetail.id;
    setLoadingTip(true);
    try {
      const res = await api.questions.askAI(targetQid, "/dica", "");
      if (res?.answer) {
        attendingTipsByQidRef.current[targetQid] = res.answer;
        setSessionAnswers((prev) => {
          const existing = prev[targetQid];
          if (!existing) return prev;
          return {
            ...prev,
            [targetQid]: { ...existing, assisted: true, attendingTip: res.answer },
          };
        });
        if (currentDetailRef.current?.id === targetQid) {
          setAttendingTip(res.answer);
        }
      } else if (currentDetailRef.current?.id === targetQid) {
        toast.error("Não foi possível gerar a dica agora.");
      }
    } catch {
      if (currentDetailRef.current?.id === targetQid) {
        toast.error("Preceptor indisponível no momento.");
      }
    } finally {
      if (currentDetailRef.current?.id === targetQid) {
        setLoadingTip(false);
      }
    }
  }, [currentDetail, loadingTip, attendingTip]);

  const stemFontClass =
    stemFontSize === "sm"
      ? "text-sm md:text-base"
      : stemFontSize === "lg"
      ? "text-lg md:text-xl"
      : "text-base md:text-lg";

  const loadQuestionDetail = useCallback(async (id: number) => {
    const requestId = ++detailRequestRef.current;
    reviewLockRef.current = false;

    const prevDetail = currentDetailRef.current;
    if (prevDetail && prevDetail.id !== id) {
      timeSpentByQidRef.current[prevDetail.id] = quizTimerRef.current?.getTime() ?? 0;
    }

    const savedAns = sessionAnswersRef.current[id];
    const pendingSubmit = pendingSubmitsRef.current[id];
    const savedTip = attendingTipsByQidRef.current[id] ?? savedAns?.attendingTip ?? null;
    const savedChat = chatMessagesByQidRef.current[id] ?? [];
    const savedWritten = savedAns?.writtenAnswer ?? pendingSubmit?.body.user_answer_text ?? draftWrittenByQidRef.current[id] ?? "";
    const savedLetter = savedAns?.letter ?? pendingSubmit?.body.selected_letter ?? draftSelectedByQidRef.current[id] ?? null;
    const targetTime = timeSpentByQidRef.current[id] ?? 0;

    setDetailError(null);
    setAttemptResult(savedAns?.result || null);
    setSelectedLetter(savedLetter);
    setUserWrittenAnswer(savedWritten);
    setIsOfflineSaved(Boolean(savedAns?.isOffline));
    setSubmitting(inFlightAttemptsRef.current.has(id));
    setChatMessages(savedChat);
    setPreceptorInput("");
    setAttendingTip(savedTip);
    setLoadingTip(false);
    setInitialTime(targetTime);
    quizTimerRef.current?.reset(targetTime);

    // 1. Se já estiver no cache em memória, carrega instantaneamente sem tela de loading
    const cached = detailsCacheRef.current[id];
    if (cached) {
      const queueItem = queueRef.current.find(q => q.id === id);
      const mergedCached = queueItem ? { ...queueItem, ...cached } : cached;
      currentDetailRef.current = mergedCached;
      setCurrentDetail(mergedCached);
      setLoadingDetail(false);
      return;
    }

    // 2. Verifica se já foi pré-carregada no Dexie em segundo plano antes de disparar HTTP individual
    const dexieMap = await getCachedQuestionsMap([id]);
    const dexieCached = dexieMap[id];
    if (dexieCached && dexieCached.stem) {
      const queueItem = queueRef.current.find(q => q.id === id);
      const mergedDexie = queueItem ? { ...queueItem, ...dexieCached } : dexieCached;
      detailsCacheRef.current[id] = mergedDexie;
      if (detailRequestRef.current === requestId) {
        currentDetailRef.current = mergedDexie;
        setCurrentDetail(mergedDexie);
        setLoadingDetail(false);
      }
      return;
    }

    setLoadingDetail(true);
    currentDetailRef.current = null;
    setCurrentDetail(null);
    try {
      const detail = await api.questions.getDetail(id);
      const queueItem = queueRef.current.find(q => q.id === id);
      const mergedDetail = queueItem ? { ...queueItem, ...detail } : detail;
      detailsCacheRef.current[id] = mergedDetail;
      if (detailRequestRef.current === requestId) {
        currentDetailRef.current = mergedDetail;
        setCurrentDetail(mergedDetail);
      }
    } catch (err) {
      console.error(`[QUIZ] Erro ao carregar questão ${id}:`, err);
      if (detailRequestRef.current === requestId) {
        const msg = err instanceof Error ? err.message : "Verifique sua conexão";
        setDetailError(`Não foi possível carregar esta questão (${msg}). Clique abaixo para tentar novamente.`);
      }
    } finally {
      if (detailRequestRef.current === requestId) setLoadingDetail(false);
    }
  }, []);

  // Pré-carregamento em segundo plano das próximas questões (Dexie + Cache em Memória + Imagens sem Waterfall)
  useEffect(() => {
    if (state !== "PLAYING" || queue.length === 0) return;

    const immediateNextId = queue[currentIndex + 1]?.id;
    if (immediateNextId && detailsCacheRef.current[immediateNextId]) {
      warmQuestionImages(detailsCacheRef.current[immediateNextId]);
    }

    const nextIds = [
      queue[currentIndex + 1]?.id,
      queue[currentIndex + 2]?.id,
      queue[currentIndex + 3]?.id,
    ].filter((id): id is number => typeof id === "number" && !detailsCacheRef.current[id] && !prefetchingRef.current.has(id));

    if (nextIds.length === 0) return;

    for (const nextId of nextIds) {
      prefetchingRef.current.add(nextId);
    }

    // Persiste no Dexie em lote via syncQueue e popula detailsCacheRef diretamente do lote/Dexie (0 chamadas getDetail individuais)
    prefetchQuestionsByIds(nextIds)
      .then(async (res) => {
        const batchMap = res?.questions || {};
        const missingFromBatch = nextIds.filter((id) => !batchMap[id]);
        const dexieMap =
          missingFromBatch.length > 0 ? await getCachedQuestionsMap(missingFromBatch) : {};

        for (const nextId of nextIds) {
          const detail = batchMap[nextId] || dexieMap[nextId];
          if (detail) {
            const queueItem = queueRef.current.find((q) => q.id === nextId);
            detailsCacheRef.current[nextId] = queueItem ? { ...queueItem, ...detail } : detail;
          }
        }

        if (immediateNextId && detailsCacheRef.current[immediateNextId]) {
          warmQuestionImages(detailsCacheRef.current[immediateNextId]);
        }
      })
      .catch(() => {
        // Ignora falhas de prefetch em segundo plano
      })
      .finally(() => {
        for (const nextId of nextIds) {
          prefetchingRef.current.delete(nextId);
        }
      });
  }, [state, queue, currentIndex]);

  const loadQueue = useCallback(async (activeFilters: Record<string, string | string[]>) => {
    const reqId = ++queueRequestRef.current;
    removeLearningSession("quiz");
    setHasSavedState(false);
    setSavedSessionData(null);
    setFilters(activeFilters);
    if (typeof activeFilters.limit === "string") setLocalLimit(activeFilters.limit);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("medquest_active_quiz", "1");
    }
    setState("LOADING_QUEUE");
    try {
      const qList = await api.questions.getList(activeFilters);
      if (queueRequestRef.current !== reqId) return;
      if (qList.length > 0) {
        reviewedQuestionsRef.current.clear();
        attendingTipsByQidRef.current = {};
        chatMessagesByQidRef.current = {};
        draftWrittenByQidRef.current = {};
        draftSelectedByQidRef.current = {};
        timeSpentByQidRef.current = {};
        sessionAnswersRef.current = {};
        pendingSubmitsRef.current = {};
        setPendingSubmits({});
        setQueue(qList);
        currentIndexRef.current = 0;
        setCurrentIndex(0);
        setSessionAnswers({});
        setEliminatedAlternatives({});
        setSelectedLetter(null);
        setAttemptResult(null);
        setState("PLAYING");
        loadQuestionDetail(qList[0].id);

        // Pré-carrega transacionalmente no Dexie as 10 próximas questões da fila
        const upcomingIds = qList.slice(1, 11).map((q) => q.id);
        if (upcomingIds.length > 0) {
          prefetchQuestionsByIds(upcomingIds).catch(() => {});
        }
      } else {
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("medquest_active_quiz");
        }
        toast.error("Nenhuma questão encontrada com esses filtros.");
        setState("FILTERS");
      }
    } catch (e) {
      if (queueRequestRef.current !== reqId) return;
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("medquest_active_quiz");
      }
      const message = e instanceof Error ? e.message : "Erro desconhecido";
      toast.error(`Erro ao buscar questões: ${message}`);
      setState("FILTERS");
    }
  }, [loadQuestionDetail]);

  // Salvaguarda: garante que, se estiver no estado PLAYING sem questão carregada ou em erro, carrega a questão atual
  useEffect(() => {
    if (state === "PLAYING" && !currentDetail && !loadingDetail && !detailError && queue[currentIndex]) {
      const timer = setTimeout(() => {
        loadQuestionDetail(queue[currentIndex].id);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [state, currentDetail, loadingDetail, detailError, queue, currentIndex, loadQuestionDetail]);

  useEffect(() => {
    if (currentDetail && sessionAnswers[currentDetail.id]) {
      const ans = sessionAnswers[currentDetail.id];
      const timer = setTimeout(() => {
        setSelectedLetter(ans.letter);
        const restoredResult = ans.result
          ? { ...ans.result, assisted: ans.result.assisted ?? ans.assisted }
          : null;
        setAttemptResult(restoredResult);
        setIsOfflineSaved(!!ans.isOffline);
        setUserWrittenAnswer(ans.writtenAnswer || "");
        const restoredTip = ans.attendingTip || attendingTipsByQidRef.current[currentDetail.id] || null;
        if (restoredTip) {
          attendingTipsByQidRef.current[currentDetail.id] = restoredTip;
          setAttendingTip(restoredTip);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [currentDetail, sessionAnswers]);

  useEffect(() => {
    const handleSyncSuccess = (e: Event) => {
      const customEvent = e as CustomEvent<{
        id: string;
        endpoint: string;
        method: string;
        data: unknown;
      }>;
      const detail = customEvent.detail;
      if (detail && detail.endpoint.includes("/api/questions/") && detail.endpoint.includes("/attempt")) {
        const attemptRes = detail.data as AttemptResult | null;
        if (attemptRes && (typeof attemptRes.is_correct === "boolean" || attemptRes.is_correct === null)) {
          const match = detail.endpoint.match(/\/api\/questions\/(\d+)\/attempt/);
          if (match) {
            const syncedQid = Number(match[1]);
            const existingAns = sessionAnswersRef.current[syncedQid];
            const preservedAssisted = Boolean(
              attemptRes.assisted ?? existingAns?.assisted ?? attendingTipsByQidRef.current[syncedQid]
            );
            const enrichedAttemptRes: AttemptResult = {
              ...attemptRes,
              assisted: preservedAssisted,
            };

            setSessionAnswers((prev) => {
              const prevEntry = prev[syncedQid];
              return {
                ...prev,
                [syncedQid]: {
                  letter: prevEntry?.letter || (currentDetailRef.current?.id === syncedQid ? selectedLetter : null) || enrichedAttemptRes.correct_letter || "A",
                  result: enrichedAttemptRes,
                  isOffline: false,
                  writtenAnswer: prevEntry?.writtenAnswer ?? (currentDetailRef.current?.id === syncedQid ? userWrittenAnswer : ""),
                  isDiscursive: prevEntry?.isDiscursive,
                  assisted: preservedAssisted,
                  attendingTip: prevEntry?.attendingTip ?? attendingTipsByQidRef.current[syncedQid] ?? null,
                },
              };
            });

            if (currentDetailRef.current?.id === syncedQid) {
              setAttemptResult(enrichedAttemptRes);
              setIsOfflineSaved(false);
              toast.success("Resposta sincronizada com sucesso!");
            } else if (
              !enrichedAttemptRes.next_review_date &&
              !reviewedQuestionsRef.current.has(syncedQid) &&
              enrichedAttemptRes.is_correct !== null &&
              enrichedAttemptRes.is_correct !== undefined
            ) {
              // O usuário já avançou de questão enquanto ela estava offline: agenda FSRS automaticamente preservando assisted
              reviewedQuestionsRef.current.add(syncedQid);
              const qItem = detailsCacheRef.current[syncedQid] || queueRef.current.find((q) => q.id === syncedQid);
              api.questions
                .reviewFSRS(
                  syncedQid,
                  "duvida",
                  enrichedAttemptRes.is_correct,
                  qItem?.twin_for_question_id,
                  enrichedAttemptRes.attempt_id,
                  preservedAssisted
                )
                .then((res) => {
                  setSessionAnswers((prev) => {
                    const curEntry = prev[syncedQid];
                    if (!curEntry || !curEntry.result) return prev;
                    return {
                      ...prev,
                      [syncedQid]: {
                        ...curEntry,
                        result: { ...curEntry.result, next_review_date: res.next_review_date },
                      },
                    };
                  });
                })
                .catch(() => {
                  reviewedQuestionsRef.current.delete(syncedQid);
                });
            }
          }
        }
      }
    };

    window.addEventListener("sync-item-success", handleSyncSuccess);
    return () => {
      window.removeEventListener("sync-item-success", handleSyncSuccess);
    };
  }, [currentDetail, selectedLetter, userWrittenAnswer]);

  const hasRestored = useRef(false);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    if (!isLocalIdentityReady(authLoaded) || hasRestored.current) return;
    hasRestored.current = true;

    const saved = readLearningSession("quiz", isSavedQuizState);
    const isExplicitResume = initialFilters.resume === "true" || initialFilters.resume === "1";
    const filterKeys = Object.keys(initialFilters).filter(k => k !== "resume");
    const isSameFilters = saved ? areFiltersEquivalent(initialFilters, saved.filters) : false;

    // Retomada explícita (?resume=true) OU sessão ativa em andamento com filtros compatíveis
    const shouldAutoResume = Boolean(
      saved &&
      (isExplicitResume ||
        (filterKeys.length > 0 && saved.state === "PLAYING" && isSameFilters))
    );

    if (saved && shouldAutoResume) {
      setTimeout(() => {
        setQueue(saved.queue);
        currentIndexRef.current = saved.currentIndex;
        setCurrentIndex(saved.currentIndex);
        setFilters(saved.filters);
        sessionAnswersRef.current = saved.sessionAnswers;
        setSessionAnswers(saved.sessionAnswers);
        if (saved.attendingTipsByQid) {
          attendingTipsByQidRef.current = { ...saved.attendingTipsByQid };
        }
        for (const [qidStr, ans] of Object.entries(saved.sessionAnswers)) {
          if (ans?.attendingTip) {
            attendingTipsByQidRef.current[Number(qidStr)] = ans.attendingTip;
          }
        }
        const restoredPending = saved.pendingSubmits ? { ...saved.pendingSubmits } : {};
        pendingSubmitsRef.current = restoredPending;
        setPendingSubmits(restoredPending);
        const targetQ = saved.queue[saved.currentIndex];
        const pendingForTarget = targetQ ? restoredPending[targetQ.id] : undefined;
        setSelectedLetter(pendingForTarget?.body.selected_letter ?? saved.selectedLetter);
        setUserWrittenAnswer(pendingForTarget?.body.user_answer_text ?? saved.userWrittenAnswer ?? "");
        if (saved.eliminatedAlternatives) {
          setEliminatedAlternatives(saved.eliminatedAlternatives);
        }
        const restoredTip =
          saved.attendingTip ||
          (targetQ ? attendingTipsByQidRef.current[targetQ.id] || saved.sessionAnswers[targetQ.id]?.attendingTip : null) ||
          null;
        setAttendingTip(restoredTip);
        setInitialTime(saved.timeSpent || 0);
        if (targetQ) {
          timeSpentByQidRef.current[targetQ.id] = saved.timeSpent || 0;
        }
        setState(saved.state);
        if (typeof window !== "undefined") {
          sessionStorage.setItem("medquest_active_quiz", "1");
        }
        if (targetQ && saved.currentDetail && saved.currentDetail.id === targetQ.id) {
          currentDetailRef.current = saved.currentDetail;
          setCurrentDetail(saved.currentDetail);
          detailsCacheRef.current[saved.currentDetail.id] = saved.currentDetail;
        } else if (targetQ) {
          currentDetailRef.current = null;
          setCurrentDetail(null);
          loadQuestionDetail(targetQ.id);
        }
        toast.success("Sessão de estudo retomada.");
        setStorageReady(true);
      }, 0);
    } else if (saved && filterKeys.length === 0) {
      // Acesso direto a /estudar (sem filtros): exibe tela de filtros com banner para retomar ou descartar
      setTimeout(() => {
        setHasSavedState(true);
        setSavedSessionData(saved);
        setState("FILTERS");
        setStorageReady(true);
      }, 0);
    } else if (filterKeys.length > 0) {
      // Nova sessão com filtros fornecidos: descarta e fecha automaticamente a anterior
      setTimeout(() => {
        loadQueue({ limit: "50", ...initialFilters });
        setStorageReady(true);
      }, 0);
    } else {
      setTimeout(() => {
        setState("FILTERS");
        setStorageReady(true);
      }, 0);
    }
  }, [authLoaded, initialFilters, loadQueue, loadQuestionDetail]);

  const resumeSavedQuiz = useCallback(() => {
    const saved = savedSessionData || readLearningSession("quiz", isSavedQuizState);
    if (saved) {
      setQueue(saved.queue);
      currentIndexRef.current = saved.currentIndex;
      setCurrentIndex(saved.currentIndex);
      setFilters(saved.filters);
      sessionAnswersRef.current = saved.sessionAnswers;
      setSessionAnswers(saved.sessionAnswers);
      if (saved.attendingTipsByQid) {
        attendingTipsByQidRef.current = { ...saved.attendingTipsByQid };
      }
      for (const [qidStr, ans] of Object.entries(saved.sessionAnswers)) {
        if (ans?.attendingTip) {
          attendingTipsByQidRef.current[Number(qidStr)] = ans.attendingTip;
        }
      }
      const restoredPending = saved.pendingSubmits ? { ...saved.pendingSubmits } : {};
      pendingSubmitsRef.current = restoredPending;
      setPendingSubmits(restoredPending);
      const targetQ = saved.queue[saved.currentIndex];
      const pendingForTarget = targetQ ? restoredPending[targetQ.id] : undefined;
      setSelectedLetter(pendingForTarget?.body.selected_letter ?? saved.selectedLetter);
      setUserWrittenAnswer(pendingForTarget?.body.user_answer_text ?? saved.userWrittenAnswer ?? "");
      if (saved.eliminatedAlternatives) {
        setEliminatedAlternatives(saved.eliminatedAlternatives);
      }
      const restoredTip =
        saved.attendingTip ||
        (targetQ ? attendingTipsByQidRef.current[targetQ.id] || saved.sessionAnswers[targetQ.id]?.attendingTip : null) ||
        null;
      setAttendingTip(restoredTip);
      setInitialTime(saved.timeSpent || 0);
      if (targetQ) {
        timeSpentByQidRef.current[targetQ.id] = saved.timeSpent || 0;
      }
      setState(saved.state);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("medquest_active_quiz", "1");
      }
      if (targetQ && saved.currentDetail && saved.currentDetail.id === targetQ.id) {
        currentDetailRef.current = saved.currentDetail;
        setCurrentDetail(saved.currentDetail);
        detailsCacheRef.current[saved.currentDetail.id] = saved.currentDetail;
      } else if (targetQ) {
        currentDetailRef.current = null;
        setCurrentDetail(null);
        loadQuestionDetail(targetQ.id);
      }
      setHasSavedState(false);
      toast.success("Sessão de estudo retomada.");
    }
  }, [savedSessionData, loadQuestionDetail]);

  const discardSavedQuiz = useCallback(() => {
    removeLearningSession("quiz");
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("medquest_active_quiz");
    }
    setHasSavedState(false);
    setSavedSessionData(null);
    toast("Sessão anterior descartada.");
  }, []);

  const ensureCurrentQuestionReviewed = useCallback(() => {
    const cur = currentDetailRef.current;
    const att = attemptResultRef.current;
    if (cur && att && !att.next_review_date && !reviewedQuestionsRef.current.has(cur.id)) {
      const qid = cur.id;
      const explicitCorr = att.is_correct;
      const isAssisted = Boolean(
        att.assisted ||
          sessionAnswersRef.current[qid]?.assisted ||
          attendingTipsByQidRef.current[qid] ||
          attendingTipRef.current
      );
      if (explicitCorr !== null && explicitCorr !== undefined) {
        reviewedQuestionsRef.current.add(qid);
        api.questions
          .reviewFSRS(qid, "duvida", explicitCorr, cur.twin_for_question_id, att.attempt_id, isAssisted)
          .then(res => {
            setSessionAnswers(prev => {
              const current = prev[qid];
              if (!current) return prev;
              return {
                ...prev,
                [qid]: {
                  ...current,
                  assisted: isAssisted,
                  result: current.result ? { ...current.result, assisted: isAssisted, next_review_date: res.next_review_date } : undefined
                }
              };
            });
          })
          .catch(() => {
            reviewedQuestionsRef.current.delete(qid);
          });
      }
    }
  }, []);

  useEffect(() => {
    const reviewedSet = reviewedQuestionsRef.current;
    return () => {
      const cur = currentDetailRef.current;
      const att = attemptResultRef.current;
      if (
        cur &&
        att &&
        !att.next_review_date &&
        !reviewedSet.has(cur.id) &&
        att.is_correct !== null &&
        att.is_correct !== undefined
      ) {
        const isAssisted = Boolean(
          att.assisted ||
            sessionAnswersRef.current[cur.id]?.assisted ||
            attendingTipsByQidRef.current[cur.id] ||
            attendingTipRef.current
        );
        reviewedSet.add(cur.id);
        api.questions
          .reviewFSRS(cur.id, "duvida", att.is_correct, cur.twin_for_question_id, att.attempt_id, isAssisted)
          .catch(() => {});
      }
    };
  }, []);

  const [showFinishModal, setShowFinishModal] = useState(false);

  const lessonCycleContext = useMemo<LessonCycleQuizContext | null>(() => {
    const rawPhase = Array.isArray(filters.cycle_phase) ? filters.cycle_phase[0] : filters.cycle_phase;
    const rawSubtema = Array.isArray(filters.subtema) ? filters.subtema[0] : filters.subtema;
    if ((rawPhase !== "pre" && rawPhase !== "post") || !rawSubtema) return null;
    const rawTarget = Array.isArray(filters.cycle_target)
      ? Number(filters.cycle_target[0])
      : Number(filters.cycle_target || (typeof filters.limit === "string" ? filters.limit : 0));
    const defaultTarget = rawPhase === "pre" ? 5 : 25;
    const target = Number.isInteger(rawTarget) && rawTarget > 0 ? rawTarget : defaultTarget;
    const rawReturnLesson = Array.isArray(filters.return_lesson)
      ? Number(filters.return_lesson[0])
      : Number(filters.return_lesson || 0);
    const returnLessonId =
      Number.isInteger(rawReturnLesson) && rawReturnLesson > 0 ? rawReturnLesson : null;
    return {
      phase: rawPhase,
      subtema: rawSubtema,
      target,
      returnLessonId,
      returnUrl: buildLessonReturnUrl({
        subtema: rawSubtema,
        lessonId: rawPhase === "pre" ? returnLessonId : null,
      }),
    };
  }, [filters]);

  const recordedCycleKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (state !== "FINISHED") {
      recordedCycleKeyRef.current = null;
      return;
    }
    if (!lessonCycleContext) return;
    const answeredEntries = Object.values(sessionAnswers).filter(
      (a) => Boolean(a && (a.result || a.isOffline))
    );
    const totalAnswered = answeredEntries.length;
    if (totalAnswered <= 0) return;
    const correctCount = answeredEntries.filter((a) => a.result?.is_correct === true).length;
    const syncKey = `${lessonCycleContext.subtema}::${lessonCycleContext.phase}::${totalAnswered}::${correctCount}`;
    if (recordedCycleKeyRef.current === syncKey) return;
    recordedCycleKeyRef.current = syncKey;

    void api.lessons
      .saveCyclePhase({
        subtema: lessonCycleContext.subtema,
        phase: lessonCycleContext.phase,
        target: lessonCycleContext.target,
        completed: totalAnswered,
        correct: correctCount,
        done: true,
      })
      .then(() => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["lessons-cycle"] }),
          queryClient.invalidateQueries({ queryKey: ["lessons-summary-by-subtema"] }),
          queryClient.invalidateQueries({ queryKey: ["lesson-detail"] }),
        ]);
      })
      .catch(() => {
        // Silencioso para visitantes sem acesso à videoteca ou offline
      });
  }, [state, lessonCycleContext, sessionAnswers, queryClient]);

  const confirmFinish = useCallback(() => {
    ensureCurrentQuestionReviewed();
    setShowFinishModal(false);
    // Invalida caches reativos após concluir sessão
    invalidateStudyCaches(queryClient);
    setState("FINISHED");
  }, [ensureCurrentQuestionReviewed, queryClient]);

  const handleRequestFinish = useCallback(() => {
    const answeredInSession = Object.values(sessionAnswers).filter(a => a.result || a.isOffline).length;
    const currentHasResult = attemptResult !== null;
    const effectiveAnswered = currentHasResult && currentDetail && !sessionAnswers[currentDetail.id]?.result 
      ? answeredInSession + 1 
      : answeredInSession;

    if (effectiveAnswered === 0) {
      toast("Você ainda não respondeu nenhuma questão. Use 'Filtros' para retornar.");
      return;
    }

    if (effectiveAnswered >= queue.length) {
      confirmFinish();
      return;
    }

    setShowFinishModal(true);
  }, [sessionAnswers, attemptResult, currentDetail, queue.length, confirmFinish]);

  useEffect(() => {
    if (!showFinishModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowFinishModal(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showFinishModal]);

  const handleBackToFilters = useCallback(() => {
    queueRequestRef.current++;
    detailRequestRef.current++;
    reviewLockRef.current = false;
    setShowFinishModal(false);
    ensureCurrentQuestionReviewed();
    removeLearningSession("quiz");
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("medquest_active_quiz");
      window.history.replaceState(null, "", window.location.pathname);
    }
    reviewedQuestionsRef.current.clear();
    attendingTipsByQidRef.current = {};
    chatMessagesByQidRef.current = {};
    draftWrittenByQidRef.current = {};
    draftSelectedByQidRef.current = {};
    timeSpentByQidRef.current = {};
    sessionAnswersRef.current = {};
    pendingSubmitsRef.current = {};
    setPendingSubmits({});
    setQueue([]);
    currentIndexRef.current = 0;
    setCurrentIndex(0);
    currentDetailRef.current = null;
    setCurrentDetail(null);
    setSelectedLetter(null);
    setUserWrittenAnswer("");
    setAttemptResult(null);
    setSessionAnswers({});
    setEliminatedAlternatives({});
    setAttendingTip(null);
    setChatMessages([]);
    setInitialTime(0);
    quizTimerRef.current?.reset(0);
    setFilters({ limit: "50", status: "unanswered", unanswered_only: "true" });
    setLocalLimit("50");
    setHasSavedState(false);
    setSavedSessionData(null);
    setState("FILTERS");
  }, [ensureCurrentQuestionReviewed]);

  // Se os filtros mudarem posteriormente via navegação de rota cliente (ex: CommandPalette / Sidebar)
  const prevFiltersJson = useRef(JSON.stringify(initialFilters));
  useEffect(() => {
    const newJson = JSON.stringify(initialFilters);
    if (!hasRestored.current) return;
    if (prevFiltersJson.current === newJson) return;
    prevFiltersJson.current = newJson;

    const filterKeys = Object.keys(initialFilters).filter(k => k !== "resume");
    const isExplicitResume = initialFilters.resume === "true" || initialFilters.resume === "1";

    const timer = setTimeout(() => {
      if (isExplicitResume) {
        resumeSavedQuiz();
      } else if (filterKeys.length > 0) {
        // Se já estiver jogando e os filtros da rota forem equivalentes à sessão atual, preserva a sessão
        if (state === "PLAYING" && areFiltersEquivalent(initialFilters, filters)) {
          return;
        }
        loadQueue({ limit: "50", ...initialFilters });
      } else {
        handleBackToFilters();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [initialFilters, state, filters, loadQueue, resumeSavedQuiz, handleBackToFilters]);

  const handleNewSession = useCallback(() => {
    handleBackToFilters();
  }, [handleBackToFilters]);

  const persistSession = useCallback((nextSelectedLetter = selectedLetter) => {
    if (!storageReady) return;
    if (state === "PLAYING" || state === "FINISHED") {
      writeLearningSession("quiz", {
        version: LEARNING_SESSION_VERSION,
        state,
        queue,
        currentIndex,
        filters,
        currentDetail,
        sessionAnswers,
        selectedLetter: nextSelectedLetter,
        userWrittenAnswer,
        attendingTip,
        timeSpent: getCurrentTime(),
        savedAt: Date.now(),
        eliminatedAlternatives,
        pendingSubmits: pendingSubmitsRef.current,
      } satisfies SavedQuizState);
    } else if (state === "FILTERS" && !hasSavedState) {
      removeLearningSession("quiz");
    }
  }, [storageReady, state, queue, currentIndex, filters, currentDetail, sessionAnswers, selectedLetter, userWrittenAnswer, attendingTip, eliminatedAlternatives, hasSavedState, getCurrentTime]);

  useEffect(() => {
    persistSession();
  }, [persistSession]);

  // Persist session before unmounting to prevent losing progress if user navigates away
  const stateRef = useRef({ state, queue, currentIndex, filters, currentDetail, sessionAnswers, selectedLetter, userWrittenAnswer, attendingTip, eliminatedAlternatives, storageReady });
  useEffect(() => {
    stateRef.current = { state, queue, currentIndex, filters, currentDetail, sessionAnswers, selectedLetter, userWrittenAnswer, attendingTip, eliminatedAlternatives, storageReady };
  }, [state, queue, currentIndex, filters, currentDetail, sessionAnswers, selectedLetter, userWrittenAnswer, attendingTip, eliminatedAlternatives, storageReady]);

  useEffect(() => {
    return () => {
      const s = stateRef.current;
      if (s.storageReady && (s.state === "PLAYING" || s.state === "FINISHED")) {
        writeLearningSession("quiz", {
          version: LEARNING_SESSION_VERSION,
          state: s.state,
          queue: s.queue,
          currentIndex: s.currentIndex,
          filters: s.filters,
          currentDetail: s.currentDetail,
          sessionAnswers: s.sessionAnswers,
          selectedLetter: s.selectedLetter,
          userWrittenAnswer: s.userWrittenAnswer,
          attendingTip: s.attendingTip,
          timeSpent: getCurrentTime(),
          savedAt: Date.now(),
          eliminatedAlternatives: s.eliminatedAlternatives,
          pendingSubmits: pendingSubmitsRef.current,
        } satisfies SavedQuizState);
      }
    };
  }, [getCurrentTime]);

  const toggleEliminateAlternative = useCallback((letter: string) => {
    if (!currentDetail || attemptResult || submitting || pendingSubmitsRef.current[currentDetail.id]) return;
    const qid = currentDetail.id;
    setEliminatedAlternatives((prev) => {
      const currentList = prev[qid] || [];
      const isEliminated = currentList.includes(letter);
      const nextList = isEliminated
        ? currentList.filter((l) => l !== letter)
        : [...currentList, letter];
      return { ...prev, [qid]: nextList };
    });
    if (selectedLetter === letter) {
      draftSelectedByQidRef.current[qid] = null;
      setSelectedLetter(null);
    }
  }, [currentDetail, attemptResult, submitting, selectedLetter]);

  const selectAlternative = useCallback((letter: string) => {
    if (attemptResult || submitting || (currentDetail && pendingSubmitsRef.current[currentDetail.id])) return;
    if (currentDetail) {
      const qid = currentDetail.id;
      draftSelectedByQidRef.current[qid] = letter;
      setEliminatedAlternatives((prev) => {
        if (!prev[qid]?.includes(letter)) return prev;
        return {
          ...prev,
          [qid]: prev[qid].filter((l) => l !== letter),
        };
      });
    }
    // Persist synchronously so a reload immediately after selecting an answer
    // can still restore the in-progress session.
    persistSession(letter);
    setSelectedLetter(letter);
  }, [attemptResult, submitting, persistSession, currentDetail]);

  // Metadados dinâmicos gerenciados via TanStack Query (useQuestionMetaQuery)



  const updateUrlWithFilters = (finalFilters: Record<string, string | string[]>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(finalFilters)) {
      if (Array.isArray(value)) {
        value.forEach(v => params.append(key, v));
      } else if (value !== undefined && value !== "") {
        params.append(key, value as string);
      }
    }
    window.history.replaceState(null, "", `/estudar?${params.toString()}`);
  };

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let finalLimit = "50";
    if (typeof filters.limit === "string" && filters.limit.trim() !== "") {
      const parsed = parseInt(filters.limit, 10);
      if (!isNaN(parsed)) {
        if (parsed < 1) finalLimit = "1";
        else if (parsed > 200) finalLimit = "200";
        else finalLimit = parsed.toString();
      }
    }
    const finalFilters = { ...filters, limit: finalLimit };
    updateUrlWithFilters(finalFilters);
    loadQueue(finalFilters);
  };

  const startRecommendedSession = useCallback((kind: "adaptive" | "review" | "wrong", focus?: "coverage" | "balanced" | "retention") => {
    const limit = kind === "review" || kind === "wrong" ? "20" : "30";
    const activeFilters = {
      limit,
      ...(kind === "adaptive"
        ? { mode: "adaptive", adaptive_focus: focus || "balanced" }
        : kind === "wrong"
        ? { status: "wrong" }
        : { status: "srs_due" }),
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(activeFilters)) {
      params.append(key, value as string);
    }
    window.history.replaceState(null, "", `/estudar?${params.toString()}`);
    loadQueue(activeFilters);
  }, [loadQueue]);

  const handleAttempt = useCallback(async () => {
    if (attemptResult || isOfflineSaved || submitting || !currentDetail || !selectedLetter) return;
    const targetQid = currentDetail.id;
    if (inFlightAttemptsRef.current.has(targetQid)) return;
    inFlightAttemptsRef.current.add(targetQid);

    setSubmitting(true);
    const targetTwinId = currentDetail.twin_for_question_id;
    const targetWritten = userWrittenAnswer;
    const targetTip = attendingTip || attendingTipsByQidRef.current[targetQid] || null;
    const isAssistedAttempt = Boolean(targetTip);

    const existingPending = pendingSubmitsRef.current[targetQid];
    let key: string;
    let body: AttemptPayload;
    if (existingPending) {
      key = existingPending.key;
      body = existingPending.body;
    } else {
      key = crypto.randomUUID();
      body = {
        selected_letter: selectedLetter,
        time_spent_ms: getCurrentTime() * 1000,
        confidence: "defer",
        ...(targetTwinId ? { twin_for_question_id: targetTwinId } : {}),
        assisted: isAssistedAttempt,
      };
      const nextPending = { ...pendingSubmitsRef.current, [targetQid]: { key, body } };
      pendingSubmitsRef.current = nextPending;
      setPendingSubmits(nextPending);
      persistSession(body.selected_letter);
    }

    const targetLetter = body.selected_letter;
    const clearPending = () => {
      if (!pendingSubmitsRef.current[targetQid]) return;
      const nextPending = { ...pendingSubmitsRef.current };
      delete nextPending[targetQid];
      pendingSubmitsRef.current = nextPending;
      setPendingSubmits(nextPending);
      persistSession(targetLetter);
    };

    try {
      const res = await api.questions.postAttempt(targetQid, body, key);
      clearPending();
      const enrichedRes: AttemptResult = { ...res, assisted: res.assisted ?? isAssistedAttempt };
      if (currentDetailRef.current?.id === targetQid) {
        setAttemptResult(enrichedRes);
        setIsOfflineSaved(false);
      }
      setSessionAnswers(prev => ({
        ...prev,
        [targetQid]: {
          letter: targetLetter,
          result: enrichedRes,
          writtenAnswer: targetWritten,
          assisted: isAssistedAttempt,
          attendingTip: targetTip,
        }
      }));

    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        clearPending();
        toast("Resposta salva neste dispositivo; será sincronizada quando a conexão voltar.");
        if (currentDetailRef.current?.id === targetQid) {
          setIsOfflineSaved(true);
        }
        setSessionAnswers(prev => ({
          ...prev,
          [targetQid]: {
            letter: targetLetter,
            isOffline: true,
            writtenAnswer: targetWritten,
            assisted: isAssistedAttempt,
            attendingTip: targetTip,
          }
        }));
      } else {
        toast.error("Não foi possível confirmar o envio. Sua escolha foi mantida — toque em Tentar de novo.");
      }
    } finally {
      inFlightAttemptsRef.current.delete(targetQid);
      if (currentDetailRef.current?.id === targetQid) {
        setSubmitting(false);
      }
    }
  }, [attemptResult, isOfflineSaved, submitting, currentDetail, selectedLetter, userWrittenAnswer, getCurrentTime, attendingTip, persistSession]);

  const handleDiscursiveReveal = useCallback(async () => {
    if (attemptResult || isOfflineSaved || submitting || !currentDetail) return;
    const targetQid = currentDetail.id;
    if (inFlightAttemptsRef.current.has(targetQid)) return;
    inFlightAttemptsRef.current.add(targetQid);

    setSubmitting(true);
    const targetTwinId = currentDetail.twin_for_question_id;
    const targetTip = attendingTip || attendingTipsByQidRef.current[targetQid] || null;
    const isAssistedAttempt = Boolean(targetTip);

    const existingPending = pendingSubmitsRef.current[targetQid];
    let key: string;
    let body: AttemptPayload;
    if (existingPending) {
      key = existingPending.key;
      body = existingPending.body;
    } else {
      key = crypto.randomUUID();
      body = {
        selected_letter: "A",
        time_spent_ms: getCurrentTime() * 1000,
        confidence: "defer",
        ...(userWrittenAnswer ? { user_answer_text: userWrittenAnswer } : {}),
        ...(targetTwinId ? { twin_for_question_id: targetTwinId } : {}),
        assisted: isAssistedAttempt,
      };
      const nextPending = { ...pendingSubmitsRef.current, [targetQid]: { key, body } };
      pendingSubmitsRef.current = nextPending;
      setPendingSubmits(nextPending);
      persistSession(selectedLetter);
    }

    const targetWritten = body.user_answer_text ?? userWrittenAnswer;
    const clearPending = () => {
      if (!pendingSubmitsRef.current[targetQid]) return;
      const nextPending = { ...pendingSubmitsRef.current };
      delete nextPending[targetQid];
      pendingSubmitsRef.current = nextPending;
      setPendingSubmits(nextPending);
      persistSession(selectedLetter);
    };

    try {
      const res = await api.questions.postAttempt(targetQid, body, key);
      clearPending();
      const enrichedRes: AttemptResult = { ...res, assisted: res.assisted ?? isAssistedAttempt };
      if (currentDetailRef.current?.id === targetQid) {
        setAttemptResult(enrichedRes);
        setIsOfflineSaved(false);
      }
      setSessionAnswers(prev => ({
        ...prev,
        [targetQid]: {
          letter: "A",
          result: enrichedRes,
          writtenAnswer: targetWritten,
          isDiscursive: true,
          assisted: isAssistedAttempt,
          attendingTip: targetTip,
        }
      }));
    } catch (e: unknown) {
      if (e instanceof OfflineQueuedError) {
        clearPending();
        if (currentDetailRef.current?.id === targetQid) {
          setIsOfflineSaved(true);
        }
        setSessionAnswers(prev => ({
          ...prev,
          [targetQid]: {
            letter: "A",
            isOffline: true,
            writtenAnswer: targetWritten,
            isDiscursive: true,
            assisted: isAssistedAttempt,
            attendingTip: targetTip,
          }
        }));
        toast("Resposta salva neste dispositivo; será sincronizada quando a conexão voltar.");
      } else {
        toast.error("Não foi possível confirmar o envio. Sua escolha foi mantida — toque em Tentar de novo.");
      }
    } finally {
      inFlightAttemptsRef.current.delete(targetQid);
      if (currentDetailRef.current?.id === targetQid) {
        setSubmitting(false);
      }
    }
  }, [attemptResult, isOfflineSaved, submitting, currentDetail, selectedLetter, userWrittenAnswer, getCurrentTime, attendingTip, persistSession]);

  const handleOpenLabs = useCallback(() => {
    setLabsOpen(true);
  }, []);

  const handleClearChat = useCallback(() => {
    if (currentDetailRef.current) {
      delete chatMessagesByQidRef.current[currentDetailRef.current.id];
    }
    setChatMessages([]);
    setPreceptorInput("");
  }, []);

  const handleSendMessage = useCallback(async (overrideText?: string) => {
    if (!currentDetail) return;
    const textToSend = (overrideText ?? preceptorInput).trim();
    if (!textToSend) return;

    const targetQid = currentDetail.id;
    const userMsg: ChatMessage = {
      id: "u_" + Date.now(),
      role: "user",
      content: textToSend,
    };

    const existingChat = chatMessagesByQidRef.current[targetQid] ?? chatMessages;
    const nextHistory = [...existingChat, userMsg];
    chatMessagesByQidRef.current[targetQid] = nextHistory;
    setChatMessages(nextHistory);
    setPreceptorInput("");
    setAskingPreceptor(true);

    try {
      const apiHistory = nextHistory.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await api.questions.askAI(
        targetQid,
        textToSend,
        selectedLetter || undefined,
        apiHistory
      );

      const assistantMsg: ChatMessage = {
        id: "a_" + Date.now(),
        role: "assistant",
        content: res.answer,
        model: res.model,
        source: res.source,
        grounding_sources: res.grounding_sources,
        tool_call: res.tool_call,
      };

      const updatedChat = [...(chatMessagesByQidRef.current[targetQid] || nextHistory), assistantMsg];
      chatMessagesByQidRef.current[targetQid] = updatedChat;
      if (currentDetailRef.current?.id === targetQid) {
        setChatMessages(updatedChat);
      }
    } catch (e: unknown) {
      if (currentDetailRef.current?.id === targetQid) {
        const msg = e instanceof Error ? e.message : "Erro ao consultar o preceptor.";
        toast.error(msg);
      }
    } finally {
      if (currentDetailRef.current?.id === targetQid) {
        setAskingPreceptor(false);
      }
    }
  }, [currentDetail, preceptorInput, chatMessages, selectedLetter]);

  const nextQuestion = useCallback(() => {
    ensureCurrentQuestionReviewed();
    const idx = currentIndexRef.current;
    if (idx + 1 < queue.length) {
      const nextIdx = idx + 1;
      currentIndexRef.current = nextIdx;
      setCurrentIndex(nextIdx);
      loadQuestionDetail(queue[nextIdx].id);
    } else {
      setState("FINISHED");
    }
  }, [queue, loadQuestionDetail, ensureCurrentQuestionReviewed]);

  const handleReviewFSRS = useCallback(async (conf: string, explicitIsCorrect?: boolean) => {
    if (!currentDetail || reviewLockRef.current) return;
    reviewLockRef.current = true;

    // Snapshot variables for background request
    const questionId = currentDetail.id;
    const twinQuestionId = currentDetail.twin_for_question_id;
    const currentAttemptResult = attemptResult;
    const currentSelectedLetter = selectedLetter;
    const currentWrittenAnswer = userWrittenAnswer;
    const isDiscursive = Boolean(currentDetail.is_discursive || (currentDetail.alternatives || []).length <= 1);
    const institutionCode = currentDetail.institution_code;

    const targetTip = attendingTip || attendingTipsByQidRef.current[questionId] || sessionAnswersRef.current[questionId]?.attendingTip || null;
    const isAssisted = Boolean(currentAttemptResult?.assisted || sessionAnswersRef.current[questionId]?.assisted || targetTip);

    // Optimistic UI updates - Update session answers synchronously before advancing
    const isCorr = explicitIsCorrect !== undefined ? explicitIsCorrect : (currentAttemptResult?.is_correct ?? false);
    const optimisticDays = !isCorr ? 7 : isAssisted ? 15 : conf === "chutei" ? 15 : conf === "certeza" ? 76 : 34;
    const optimisticDueIso =
      currentAttemptResult?.next_review_date ??
      new Date(Date.now() + optimisticDays * 86400_000).toISOString();

    const optimisticResult: AttemptResult = {
      ...(currentAttemptResult || {
        correct_letter: institutionCode || "A",
        explanation: null,
      }),
      is_correct: isCorr,
      assisted: isAssisted,
      next_review_date: optimisticDueIso,
    };
    attemptResultRef.current = optimisticResult;
    reviewedQuestionsRef.current.add(questionId);

    setSessionAnswers(prev => ({
      ...prev,
      [questionId]: {
        letter: currentSelectedLetter || "A",
        result: optimisticResult,
        writtenAnswer: currentWrittenAnswer,
        isDiscursive: isDiscursive,
        assisted: isAssisted,
        attendingTip: targetTip,
      }
    }));

    const idx = currentIndexRef.current;
    if (idx + 1 < queue.length) {
      const nextIdx = idx + 1;
      currentIndexRef.current = nextIdx;
      setCurrentIndex(nextIdx);
      loadQuestionDetail(queue[nextIdx].id);
    } else {
      setState("FINISHED");
      setTimeout(() => {
        reviewLockRef.current = false;
      }, 0);
    }

    // Call API in background to persist FSRS card and next review date
    try {
      const res = await api.questions.reviewFSRS(
        questionId,
        conf,
        explicitIsCorrect,
        twinQuestionId,
        currentAttemptResult?.attempt_id,
        isAssisted
      );
      const updatedResult: AttemptResult = {
        ...optimisticResult,
        next_review_date: res.next_review_date,
      };

      // Reconcile next_review_date from API response
      setSessionAnswers(prev => ({
        ...prev,
        [questionId]: {
          letter: currentSelectedLetter || "A",
          result: updatedResult,
          writtenAnswer: currentWrittenAnswer,
          isDiscursive: isDiscursive,
          assisted: isAssisted,
          attendingTip: targetTip,
        }
      }));
    } catch {
      reviewedQuestionsRef.current.delete(questionId);
      toast.error("Erro ao salvar revisão (FSRS) em background.");
    }
  }, [currentDetail, attemptResult, selectedLetter, userWrittenAnswer, queue, loadQuestionDetail, attendingTip]);

  const prevQuestion = useCallback(() => {
    ensureCurrentQuestionReviewed();
    const idx = currentIndexRef.current;
    if (idx > 0) {
      const prevIdx = idx - 1;
      currentIndexRef.current = prevIdx;
      setCurrentIndex(prevIdx);
      loadQuestionDetail(queue[prevIdx].id);
    }
  }, [queue, loadQuestionDetail, ensureCurrentQuestionReviewed]);

  const navigateQuestion = useCallback((direction: "next" | "previous") => {
    if (direction === "previous") {
      prevQuestion();
      return;
    }
    nextQuestion();
  }, [nextQuestion, prevQuestion]);

  const toggleFavorite = useCallback(async () => {
    if (!currentDetail || togglingFavorite || favoriteLockRef.current) return;
    favoriteLockRef.current = true;
    setTogglingFavorite(true);
    const updated = { ...currentDetail, is_favorite: !currentDetail.is_favorite };
    setCurrentDetail(updated);
    detailsCacheRef.current[updated.id] = updated;
    try {
      await api.questions.toggleFavorite(currentDetail.id);
    } catch {
      setCurrentDetail(currentDetail);
      detailsCacheRef.current[currentDetail.id] = currentDetail;
    } finally {
      favoriteLockRef.current = false;
      setTogglingFavorite(false);
    }
  }, [currentDetail, togglingFavorite]);

  useQuizKeyboard({
    state,
    currentDetail,
    loadingDetail,
    attemptResult,
    currentIndex,
    queue,
    selectedLetter,
    submitting,
    handleAttempt,
    handleDiscursiveReveal,
    handleReviewFSRS,
    nextQuestion,
    prevQuestion,
    navigateQuestion,
    selectAlternative,
    toggleEliminate: toggleEliminateAlternative,
    disabled: Boolean(showFinishModal || isClassificationModalOpen || enlargedImage || labsOpen)
  });

  if (state === "FILTERS") {
    return (
      <QuizFilters
        hasSavedState={hasSavedState}
        savedSessionData={savedSessionData}
        discardSavedQuiz={discardSavedQuiz}
        resumeSavedQuiz={resumeSavedQuiz}
        showCustomSession={showCustomSession}
        setShowCustomSession={setShowCustomSession}
        startRecommendedSession={startRecommendedSession}
        handleFilterSubmit={handleFilterSubmit}
        filters={filters}
        setFilters={setFilters}
        localLimit={localLimit}
        setLocalLimit={setLocalLimit}
        isUpdatingMeta={isUpdatingMeta}
        dynamicMeta={dynamicMeta}
        subtemaSearch={subtemaSearch}
        setSubtemaSearch={setSubtemaSearch}
        showTopicTree={showTopicTree}
        setShowTopicTree={setShowTopicTree}
        onQuickStartFilters={(customFilters) => {
          updateUrlWithFilters(customFilters);
          loadQueue(customFilters);
        }}
      />
    );
  }
  if (state === "LOADING_QUEUE") {
    return <QuizLoadingView />;
  }

  if (state === "FINISHED") {
    return (
      <QuizSummaryView
        sessionAnswers={sessionAnswers}
        lessonCycleContext={lessonCycleContext}
        onBackToFilters={handleNewSession}
        onRestartSession={() => {
          reviewedQuestionsRef.current.clear();
          attendingTipsByQidRef.current = {};
          chatMessagesByQidRef.current = {};
          draftWrittenByQidRef.current = {};
          draftSelectedByQidRef.current = {};
          timeSpentByQidRef.current = {};
          sessionAnswersRef.current = {};
          pendingSubmitsRef.current = {};
          setPendingSubmits({});
          setSessionAnswers({});
          setEliminatedAlternatives({});
          setSelectedLetter(null);
          setUserWrittenAnswer("");
          setAttemptResult(null);
          setAttendingTip(null);
          setChatMessages([]);
          setInitialTime(0);
          quizTimerRef.current?.reset(0);
          setState("PLAYING");
          currentIndexRef.current = 0;
          setCurrentIndex(0);
          if (queue.length > 0) {
            loadQuestionDetail(queue[0].id);
          }
        }}
      />
    );
  }

  // PLAYING STATE
  const q = currentDetail;
  const hasPendingSubmit = Boolean(q && pendingSubmits[q.id]);
  const completedCount = Object.values(sessionAnswers).filter(answer => answer.result || answer.isOffline).length;
  const extraCaseImages = filterExtraImages(q?.clinical_case?.images, q?.clinical_case?.stem);
  const extraStemImages = filterExtraImages(q?.images, q?.stem);

  return (
    <div className={clsx("mx-auto w-full flex flex-col gap-4 pb-12 relative", zenMode ? "max-w-4xl" : "max-w-7xl px-2 sm:px-4")}>
      {/* Fullscreen Image Modal */}
      {enlargedImage && (
        <ImageViewer 
          src={normalizeImageSrc(enlargedImage)} 
          isOpen={!!enlargedImage} 
          onClose={() => setEnlargedImage(null)} 
        />
      )}
      <LabValuesModal open={labsOpen} onClose={() => setLabsOpen(false)} />
      {/* Top Bar */}
      <QuizHeader
        onBackToFilters={handleBackToFilters}
        completedCount={completedCount}
        totalCount={queue.length}
        onRequestFinish={handleRequestFinish}
        zenMode={zenMode}
        onToggleZenMode={toggleZenMode}
        quizTimerRef={quizTimerRef}
        isTimerRunning={state === "PLAYING" && !!currentDetail && !attemptResult}
        initialTime={initialTime}
        hasQuestion={Boolean(q)}
        isFavorite={q?.is_favorite}
        onToggleFavorite={toggleFavorite}
        onOpenLabs={handleOpenLabs}
        stemFontSize={stemFontSize}
        onCycleFontSize={cycleFontSize}
      />

      {lessonCycleContext && (
        <div className="bg-primary/5 border border-primary/25 text-ink rounded-sm px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs shadow-xs">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded-xs bg-primary/15 text-primary font-bold font-mono-lab uppercase text-[10px] shrink-0">
              {lessonCycleContext.phase === "pre"
                ? `Etapa 1/3 • Pré-aula (${lessonCycleContext.target}q)`
                : `Etapa 3/3 • Pós-aula (${lessonCycleContext.target}q)`}
            </span>
            <span className="text-ink-secondary truncate">
              {lessonCycleContext.phase === "pre"
                ? `Aquecimento ativo antes da aula de ${lessonCycleContext.subtema}`
                : `Fixação pós-aula de ${lessonCycleContext.subtema}`}
            </span>
          </div>
          <Link
            href={lessonCycleContext.returnUrl}
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline shrink-0"
          >
            <PlayCircle size={13} />
            {lessonCycleContext.phase === "pre" ? "Ir direto para a aula →" : "Voltar para as aulas"}
          </Link>
        </div>
      )}

      {filters.mode === "remediation" && (
        <div className="bg-critical/5 border border-critical/25 text-ink rounded-sm px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs shadow-xs">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-xs bg-critical/15 text-critical font-bold font-mono-lab uppercase text-[10px]">
              Treino de Recuperação Ativa
            </span>
            <span className="text-ink-muted">
              Focando na retificação das questões erradas e conceitos vulneráveis.
            </span>
          </div>
          {queue[currentIndex]?.remediation_reason === "unresolved_error" ? (
            <span className="hidden sm:inline-flex items-center gap-1 font-semibold text-critical">
              Questão do Caderno de Erros
            </span>
          ) : queue[currentIndex]?.remediation_reason === "twin_unseen_concept" ? (
            <span className="hidden sm:inline-flex items-center gap-1 font-semibold text-accent">
              Questão Gêmea (Conceito Inédito)
            </span>
          ) : null}
        </div>
      )}

      {detailError ? (
        <div className="bg-surface border border-line-subtle shadow-xs rounded-sm p-8 min-h-64 flex flex-col gap-4 items-center justify-center text-center" role="alert">
          <AlertTriangle className="text-critical" size={32} />
          <p className="font-bold text-ink text-sm">Erro ao carregar a questão</p>
          <p className="text-xs text-ink-muted max-w-md">{detailError}</p>
          <button
            onClick={() => queue[currentIndex] && loadQuestionDetail(queue[currentIndex].id)}
            className="flex items-center gap-2 bg-accent text-white px-3.5 py-2 rounded-sm hover:opacity-90 transition-opacity font-semibold text-xs cursor-pointer shadow-xs"
          >
            <RotateCcw size={14} /> Tentar novamente
          </button>
        </div>
      ) : loadingDetail || !q ? (
        <div className="flex flex-col gap-4">
          <div className="bg-surface border border-line-subtle rounded-md p-6 h-36" />
          <div className="flex flex-col gap-2.5">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-12 bg-surface border border-line-subtle rounded-md" />)}
          </div>
        </div>
      ) : (
        <div className={clsx(
          "grid gap-6 items-start w-full",
          zenMode
            ? "grid-cols-1 max-w-4xl mx-auto"
            : "lg:grid-cols-12"
        )}>
          {q.clinical_case && (
            <div className={clsx(
              "bg-surface border border-accent/35 shadow-2xs rounded-md p-5 md:p-6 flex flex-col gap-4",
              !zenMode && "lg:col-span-6 lg:sticky lg:top-20 h-fit max-h-[calc(100vh-6rem)] overflow-y-auto"
            )}>
              <h4 className="text-xs font-bold text-accent uppercase tracking-wider flex items-center gap-2 font-mono-lab">
                <BookOpen size={16} /> Caso Clínico Associado
              </h4>
              <FormattedContent 
                content={q.clinical_case.stem} 
                onImageClick={setEnlargedImage} 
                className="text-ink text-base md:text-lg leading-relaxed font-normal" 
              />
              {extraCaseImages.length > 0 && (
                <div className="flex flex-col sm:flex-row flex-wrap gap-3 mt-1">
                  {extraCaseImages.map((img, i) => (
                    <div 
                      key={i} 
                      className="relative group rounded-sm overflow-hidden border border-line-subtle bg-canvas cursor-zoom-in hover:border-line-strong transition-all sm:max-w-xs"
                      onClick={() => setEnlargedImage(img)}
                    >
                      <Image
                        src={normalizeImageSrc(img)} 
                        alt={`Imagem do Caso ${i+1}`} 
                        width={800}
                        height={600}
                        unoptimized
                        className="max-w-full h-auto object-cover hover:scale-[1.01] transition-transform duration-200" 
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Question Stem: quando não há caso clínico, ocupa coluna 7 no desktop */}
          <div className={clsx("flex flex-col gap-5", !zenMode && (q.clinical_case ? "lg:col-span-6" : "lg:col-span-7"))}>
            {/* Question Stem Card */}
            <div className="bg-surface border border-line-subtle shadow-xs rounded-sm p-5 md:p-6 flex flex-col gap-5">
              {q.technical_note && (
                <div className="bg-warning/10 border border-warning/30 rounded-xs p-3.5 flex gap-3 text-ink text-xs shadow-xs">
                  <AlertTriangle className="text-warning shrink-0 mt-0.5" size={18} />
                  <div>
                    <p className="font-bold text-ink mb-0.5 uppercase tracking-wider font-mono-lab text-[11px]">Atenção: Questão Histórica / Desatualizada</p>
                    <p className="leading-relaxed">{q.technical_note}</p>
                  </div>
                </div>
              )}
              <div className="flex items-start md:items-center justify-between flex-col md:flex-row gap-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                  {q.is_verified && (
                    <span className="bg-normal/10 text-normal border border-normal/30 px-2 py-0.5 rounded-xs flex items-center gap-1 text-[11px] font-mono-lab" title={q.last_updated_at ? `Revisado em ${q.last_updated_at}` : "Revisado por um médico"}>
                      <ClinicalIcon name="checkCircle" size={12} /> Revisado
                    </span>
                  )}
                  {Boolean(q.is_discursive || (q.alternatives || []).length <= 1) && (
                    <span className="bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-xs flex items-center gap-1 font-bold text-[11px] font-mono-lab">
                      Discursiva
                    </span>
                  )}
                  <span className="bg-canvas border border-line-subtle text-ink px-2 py-0.5 rounded-xs font-mono-lab text-[11px] font-bold">
                    {q.institution_code}{q.is_autoral ? " (A)" : ""} {q.year}
                  </span>
                  {q.is_target_institution && (
                    <span
                      className="bg-primary/10 text-primary border border-primary/30 px-2 py-0.5 rounded-xs flex items-center gap-1 font-bold font-mono-lab text-[11px] animate-in fade-in"
                      title="Questão da sua banca-alvo selecionada no Planejador de Residência"
                    >
                      <Target size={12} className="text-primary shrink-0" /> Alvo Residência
                    </span>
                  )}
                  {q.is_twin && (
                    <span
                      className="bg-accent/10 text-accent border border-accent/30 px-2 py-0.5 rounded-xs flex items-center gap-1 font-bold font-mono-lab text-[11px] animate-in fade-in"
                      title={q.twin_origin_institution ? `Questão Gêmea: aplicando o conceito de ${q.twin_subtema || q.subtema} (revisão de ${q.twin_origin_institution}) a um novo caso clínico para testar seu raciocínio real sem vícios de memorização.` : "Questão Gêmea: aplicando o conceito a um novo caso clínico."}
                    >
                      <ClinicalIcon name="sparkles" size={12} />
                      Questão Gêmea{q.twin_origin_institution ? ` (${q.twin_origin_institution})` : ""}
                    </span>
                  )}
                  {(q.area || q.subtema) && (
                    <button
                      type="button"
                      onClick={toggleTopic}
                      className="bg-canvas border border-line-subtle px-2 py-0.5 rounded-xs flex items-center gap-1.5 transition-colors hover:bg-elevated cursor-pointer text-left text-[11px] font-mono-lab text-ink-muted"
                      title={showTopic ? "Ocultar Tema" : "Mostrar Tema"}
                    >
                      {showTopic ? (
                        <>
                          <span className="flex items-center gap-1.5">
                            {q.area && <span>{q.area}</span>}
                            {q.area && q.subtema && <span>&bull;</span>}
                            {q.subtema && <span>{q.subtema}</span>}
                          </span>
                          <EyeOff size={12} className="text-ink-muted ml-0.5" />
                        </>
                      ) : (
                        <>
                          <span>Tema Oculto</span>
                          <Eye size={12} className="text-ink-muted ml-0.5" />
                        </>
                      )}
                    </button>
                  )}
                  {isCurator && (
                    <button
                      type="button"
                      onClick={() => setIsClassificationModalOpen(true)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xs bg-accent/10 hover:bg-accent/20 text-accent border border-accent/25 transition-colors font-bold text-[11px] font-mono-lab cursor-pointer shadow-xs"
                      title="Editar Classificação da Questão (Curadoria)"
                    >
                      <Pencil size={11} /> Editar Tema
                    </button>
                  )}
                </div>
                
                <div className="flex items-center gap-1 bg-canvas px-1.5 py-0.5 rounded-xs border border-line-subtle">
                  <button 
                    type="button"
                    onClick={() => navigateQuestion("previous")}
                    disabled={currentIndex === 0 || loadingDetail}
                    className="p-1.5 min-w-[38px] min-h-[38px] flex items-center justify-center hover:bg-elevated rounded-xs transition-colors disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent text-ink-muted hover:text-ink"
                    title="Questão Anterior (Seta Esquerda)"
                    aria-label="Questão Anterior"
                  >
                    <ClinicalIcon name="arrowLeft" size={14} aria-hidden="true" />
                  </button>
                  <span className="text-xs font-mono-lab tabular-nums font-bold text-ink min-w-[2.5rem] text-center select-none">
                    {currentIndex + 1} / {queue.length}
                  </span>
                  <button 
                    type="button"
                    onClick={() => navigateQuestion("next")}
                    disabled={loadingDetail}
                    className="p-1.5 min-w-[38px] min-h-[38px] flex items-center justify-center hover:bg-elevated rounded-xs transition-colors disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent text-ink-muted hover:text-ink"
                    title="Próxima questão (Seta Direita)"
                    aria-label="Próxima Questão"
                  >
                    <ClinicalIcon name="arrowRight" size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <FormattedContent 
                content={q.stem} 
                onImageClick={setEnlargedImage} 
                className={`text-ink ${stemFontClass} leading-relaxed font-normal`} 
              />

              {extraStemImages.length > 0 && (
                <div className="flex flex-col sm:flex-row flex-wrap gap-3 mt-2">
                  {extraStemImages.map((img, i) => (
                    <div 
                      key={i} 
                      className="relative group rounded-sm overflow-hidden border border-line-subtle bg-canvas cursor-zoom-in hover:border-line-strong transition-all sm:max-w-sm"
                      onClick={() => setEnlargedImage(img)}
                    >
                      <Image
                        src={normalizeImageSrc(img)} 
                        alt={`Imagem ${i+1}`} 
                        width={800}
                        height={600}
                        unoptimized
                        className="max-w-full h-auto object-cover hover:scale-[1.01] transition-transform duration-200" 
                        onError={(e) => { 
                          e.currentTarget.style.display = 'none'; 
                          if (e.currentTarget.nextElementSibling) {
                            (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex';
                          }
                        }} 
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center pointer-events-none">
                        <ClinicalIcon name="maximize" size={18} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                      </div>
                      <div className="hidden flex-col items-center justify-center p-6 text-ink-muted gap-2">
                        <ImageOff size={24} />
                        <span className="text-xs font-mono-lab">Imagem indisponível</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {(!attemptResult || attendingTip) && (
                <div className="pt-2">
                  {!attendingTip ? (
                    <button
                      type="button"
                      onClick={handleRequestAttendingTip}
                      disabled={loadingTip}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/25 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60"
                    >
                      {loadingTip ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Lightbulb size={14} />
                      )}
                      {loadingTip ? "Gerando dica clínica..." : "Dica do Preceptor (sem spoiler)"}
                    </button>
                  ) : (
                    <div className="p-3.5 rounded-2xl bg-amber-500/8 border border-amber-500/25 text-xs sm:text-sm text-ink-primary leading-relaxed flex items-start gap-2.5">
                      <Lightbulb size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 mb-0.5">
                          Dica do Preceptor
                        </p>
                        <p>{attendingTip}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <QuestionNotePanel questionId={q.id} />
          </div>

          {/* PAINEL DIREITO: Alternativas e Ações de Resposta */}
          <div className={clsx(
            "flex flex-col gap-4",
            !zenMode && (
              q.clinical_case
                ? "lg:col-span-6"
                : "lg:col-span-5"
            )
          )}>
            {/* Alternatives or Discursive Response */}
            {Boolean(q.is_discursive || (q.alternatives || []).length <= 1) ? (
              !attemptResult && (
                <div className="bg-surface border border-line-subtle shadow-xs rounded-sm p-5 md:p-6 flex flex-col gap-3.5 animate-in fade-in duration-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-accent font-bold text-sm">
                      <ClinicalIcon name="notes" size={16} />
                      <span>Questão Discursiva (Resposta Aberta)</span>
                    </div>
                    <span className="text-[11px] font-mono-lab text-ink-muted">
                      Atalho: <kbd className="bg-canvas px-1 py-0.5 rounded-xs border border-line-subtle text-[10px] text-ink">Ctrl+Enter</kbd>
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    Anote seus achados clínicos, hipótese diagnóstica ou conduta antes de revelar o gabarito e padrão oficial da banca:
                  </p>
                  <textarea
                    value={userWrittenAnswer}
                    readOnly={hasPendingSubmit}
                    onChange={(e) => {
                      if (hasPendingSubmit) return;
                      const val = e.target.value;
                      if (q) {
                        draftWrittenByQidRef.current[q.id] = val;
                      }
                      setUserWrittenAnswer(val);
                    }}
                    placeholder="Escreva sua hipótese diagnóstica ou conduta aqui..."
                    rows={4}
                    className="w-full bg-canvas border border-line-subtle focus:border-accent focus:bg-surface rounded-sm p-3.5 text-ink placeholder:text-ink-muted/60 focus:outline-none focus:ring-1 focus:ring-accent transition-all resize-y text-sm font-normal leading-relaxed min-h-[100px]"
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        handleDiscursiveReveal();
                      }
                    }}
                  />
                  <button
                    onClick={handleDiscursiveReveal}
                    disabled={submitting}
                    className="w-full bg-accent hover:opacity-90 text-white font-bold py-3 rounded-sm transition-opacity flex items-center justify-center gap-2 shadow-xs cursor-pointer text-xs uppercase tracking-wider font-mono-lab disabled:opacity-50"
                  >
                    {submitting ? (
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <ClinicalIcon name="checkCircle" size={14} />
                        {hasPendingSubmit ? "Tentar de novo" : "Confirmar Resposta & Ver Padrão da Banca"}
                      </>
                    )}
                  </button>
                </div>
              )
            ) : (
              <div className="flex flex-col gap-2.5">
                <AlternativeList
                  alternatives={q.alternatives || []}
                  selectedLetter={selectedLetter}
                  attemptResult={attemptResult}
                  eliminatedLetters={eliminatedAlternatives[q.id] || EMPTY_ELIMINATED}
                  submitting={submitting}
                  onSelectAlternative={selectAlternative}
                  onToggleEliminate={toggleEliminateAlternative}
                  onImageClick={setEnlargedImage}
                  questionId={q.id}
                  alreadyAnsweredLetter={q.already_answered?.selected_letter ?? null}
                />

                {!attemptResult && !isOfflineSaved && selectedLetter && (
                  <button
                    onClick={handleAttempt}
                    disabled={submitting}
                    className="mt-1 w-full bg-accent hover:opacity-90 text-white font-bold py-3 rounded-sm transition-opacity flex items-center justify-center shadow-xs text-xs uppercase tracking-wider font-mono-lab cursor-pointer disabled:opacity-50"
                  >
                    {submitting ? (
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      hasPendingSubmit ? "Tentar de novo" : "Confirmar Resposta [Enter]"
                    )}
                  </button>
                )}
              </div>
            )}

          {/* Offline Saved Banner */}
          {isOfflineSaved && (
            <div className="bg-accent/10 border border-accent/25 rounded-sm p-4 flex flex-col gap-3 text-ink animate-in slide-in-from-bottom-2 duration-200 shadow-xs mt-2">
              <div className="flex items-center gap-3">
                <CloudOff className="text-accent shrink-0" size={20} />
                <div>
                  <p className="font-bold text-xs uppercase tracking-wider font-mono-lab">Resposta Salva Offline</p>
                  <p className="text-xs text-ink-muted">Sua resposta foi salva neste dispositivo e será sincronizada automaticamente assim que a conexão for restabelecida.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-accent/20">
                <button
                  type="button"
                  onClick={async () => {
                    if (!navigator.onLine) {
                      toast("Ainda sem conexão com a internet. Sua resposta segue gravada localmente.");
                      return;
                    }
                    try {
                      const { syncManager } = await import("@/lib/sync");
                      await syncManager.sync(true);
                    } catch (e) {
                      if (e instanceof OfflineQueuedError) {
                        toast("Sem conexão com a internet no momento.");
                      } else {
                        toast.error("Erro ao sincronizar.");
                      }
                    }
                  }}
                  className="flex items-center gap-1.5 text-xs font-mono-lab font-bold text-accent hover:text-accent/80 transition-colors bg-surface border border-line-subtle px-2.5 py-1.5 rounded-xs"
                >
                  <RotateCcw size={12} /> Sincronizar Gabarito Agora
                </button>
                {currentIndex === queue.length - 1 ? (
                  <button
                    type="button"
                    onClick={confirmFinish}
                    className="flex items-center gap-1.5 bg-accent text-white font-mono-lab font-bold px-3 py-1.5 rounded-xs transition-opacity text-xs hover:opacity-90 cursor-pointer shadow-xs"
                  >
                    Finalizar Sessão <CheckCircle2 size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={nextQuestion}
                    className="flex items-center gap-1.5 bg-accent text-white font-mono-lab font-bold px-3 py-1.5 rounded-xs transition-opacity text-xs hover:opacity-90 cursor-pointer"
                  >
                    Próxima Questão <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </div>
          )}
          </div>

          {/* BLOCO PÓS-TENTATIVA (Abaixo da Questão em Largura Total) */}
          {attemptResult && (
            <div className={clsx(
              "w-full flex flex-col gap-5 animate-in slide-in-from-bottom-2 fade-in duration-200",
              !zenMode && "lg:col-span-12"
            )}>
              {/* If question is discursive, show user's written answer and the board's short expected answer */}
              {Boolean(q.is_discursive || (q.alternatives || []).length <= 1) && (
                <div className="bg-surface border border-line-subtle shadow-xs rounded-sm p-4 md:p-5 flex flex-col gap-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {userWrittenAnswer ? (
                      <div className="flex flex-col gap-1.5 bg-canvas p-3 rounded-xs border border-line-subtle">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-ink-muted uppercase tracking-wider font-mono-lab">
                          <ClinicalIcon name="notes" size={13} />
                          <span>Sua Resposta Anotada</span>
                        </div>
                        <div className="text-ink text-sm leading-relaxed whitespace-pre-wrap font-normal">
                          {userWrittenAnswer}
                        </div>
                      </div>
                    ) : null}
                    {q.alternatives?.[0]?.text && !/^(?:anote sua|questão dissertativa|ver padrão)/i.test(q.alternatives[0].text) && (
                      <div className={clsx(
                        "flex flex-col gap-1.5 bg-normal/10 p-3 rounded-xs border border-normal/25",
                        !userWrittenAnswer && "md:col-span-2"
                      )}>
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-normal uppercase tracking-wider font-mono-lab">
                          <ClinicalIcon name="checkCircle" size={13} />
                          <span>Resposta Curta Esperada pela Banca</span>
                        </div>
                        <div className="text-ink text-sm leading-relaxed font-bold">
                          <AlternativeContent content={q.alternatives[0].text} onImageClick={setEnlargedImage} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className={clsx(
                "rounded-sm border shadow-xs overflow-hidden",
                attemptResult.is_correct === true ? "bg-normal/5 border-normal/25" :
                attemptResult.is_correct === false ? "bg-critical/5 border-critical/25" :
                "bg-surface border-line-subtle"
              )}>
                <div className={clsx(
                  "px-4 py-3 border-b flex items-center justify-between",
                  attemptResult.is_correct === true ? "border-normal/20 bg-normal/10" :
                  attemptResult.is_correct === false ? "border-critical/20 bg-critical/10" :
                  "border-line-subtle bg-canvas"
                )}>
                  <div className="flex flex-wrap items-center gap-2 font-bold text-sm">
                    {attemptResult.is_correct === true ? (
                      <>
                        <ClinicalIcon name="checkCircle" size={16} className="text-normal" />
                        <span className="text-normal font-mono-lab uppercase tracking-wide">
                          {attemptResult.assisted || Boolean(attendingTip)
                            ? "Resposta Correta (com ajuda)"
                            : "Resposta Correta"}
                        </span>
                        {(attemptResult.assisted || Boolean(attendingTip)) && (
                          <span className="text-[10px] font-mono-lab px-2 py-0.5 rounded-xs bg-warning/15 text-warning border border-warning/30">
                            Dica do Preceptor usada • FSRS calibrado
                          </span>
                        )}
                      </>
                    ) : attemptResult.is_correct === false ? (
                      <><ClinicalIcon name="crossCircle" size={16} className="text-critical" /> <span className="text-critical font-mono-lab uppercase tracking-wide">Resposta Incorreta</span></>
                    ) : (
                      <><ClinicalIcon name="checkCircle" size={16} className="text-accent" /> <span className="text-ink font-mono-lab uppercase tracking-wide">Padrão Oficial da Banca</span></>
                    )}
                  </div>
                  {attemptResult.is_correct !== null && (
                    <div className="flex items-center gap-2">
                      {currentIndex < queue.length - 1 && (
                        <button
                          type="button"
                          onClick={handleRequestFinish}
                          className="flex items-center gap-1 bg-surface border border-line-subtle hover:bg-elevated font-mono-lab text-ink-muted hover:text-ink px-2.5 py-1 rounded-xs transition-colors text-[11px] cursor-pointer"
                          title="Finalizar sessão agora"
                        >
                          <CheckCircle2 size={12} /> Finalizar
                        </button>
                      )}
                      <button
                        onClick={nextQuestion}
                        className="flex items-center gap-1.5 bg-surface border border-line-subtle hover:bg-elevated font-mono-lab font-bold text-ink px-3 py-1 rounded-xs transition-colors text-xs cursor-pointer"
                      >
                        {currentIndex === queue.length - 1 ? (
                          <>Finalizar <CheckCircle2 size={14} className="text-normal" /></>
                        ) : (
                          <>Próxima <ArrowRight size={14} /></>
                        )}
                      </button>
                    </div>
                  )}
                </div>
                
                <div className="p-4 md:p-6 flex flex-col gap-5">
                  <h3 className="text-sm font-bold text-ink flex items-center gap-2 uppercase tracking-wider font-mono-lab">
                    <ClinicalIcon name="notes" size={16} className="text-accent" />
                    {Boolean(q.is_discursive || (q.alternatives || []).length <= 1) ? "Padrão de Resposta da Banca & Comentário" : "Comentário do Professor"}
                  </h3>
                  <ExplanationViewer 
                    explanation={attemptResult.explanation} 
                    correctLetter={Boolean(q.is_discursive || (q.alternatives || []).length <= 1) ? null : attemptResult.correct_letter}
                    questionId={currentDetail?.id}
                    userLetter={selectedLetter || attemptResult.correct_letter || undefined}
                    isDiscursive={Boolean(q.is_discursive || (q.alternatives || []).length <= 1)}
                  />

                  {currentDetail?.times_wrong && currentDetail.times_wrong > 0 ? (
                    <div className="flex items-center gap-1.5 text-xs text-critical font-mono-lab font-semibold bg-critical/10 border border-critical/20 px-2.5 py-1 rounded-xs w-fit">
                      Você já errou esta questão {currentDetail.times_wrong} {currentDetail.times_wrong === 1 ? 'vez' : 'vezes'} no passado.
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!q || !attemptResult) return;
                        const card = buildAnkiCardFromQuestion(q, attemptResult);
                        const mode = await sendCardToAnki(card);
                        toast.success(
                          mode === "ankiconnect"
                            ? "Card enviado para o Anki Desktop!"
                            : "AnkiConnect offline: arquivo .tsv baixado para importar no Anki!"
                        );
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xs border border-line-subtle bg-elevated hover:bg-canvas hover:border-accent text-xs font-semibold text-ink-primary transition-colors cursor-pointer"
                    >
                      <BookOpen size={13} className="text-accent" />
                      Enviar para o Anki (.tsv / AnkiConnect)
                    </button>
                  </div>
                  
                  {/* Ferramenta de Estudo Ativo: Preceptor AI */}
                  <div className="w-full">
                    <PreceptorSection
                      messages={chatMessages}
                      preceptorInput={preceptorInput}
                      askingPreceptor={askingPreceptor}
                      onSendMessage={handleSendMessage}
                      onClearChat={handleClearChat}
                    />
                  </div>

                  {/* Self-Assessment / FSRS Block */}
                  {attemptResult.is_correct === null ? (
                    <DiscursiveAssessmentSection onReviewFSRS={handleReviewFSRS} />
                  ) : attemptResult.next_review_date ? (
                    <div className="pt-3 border-t border-line-subtle flex items-center justify-between flex-wrap gap-2 text-xs font-mono-lab text-ink-muted">
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} />
                        Próxima revisão FSRS: {formatReviewDatePtBr(attemptResult.next_review_date)}
                      </div>
                      {Boolean(q.is_discursive || (q.alternatives || []).length <= 1) && (
                        <button
                          onClick={() => setAttemptResult(prev => prev ? { ...prev, is_correct: null } : null)}
                          className="text-xs text-accent hover:underline font-semibold cursor-pointer"
                        >
                          Alterar autoavaliação
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="pt-3 border-t border-line-subtle flex flex-col gap-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-bold text-ink uppercase tracking-wider font-mono-lab">
                          {attemptResult.is_correct 
                            ? "Como foi resolver essa questão?" 
                            : "Revisão agendada (FSRS v6):"}
                        </span>
                        <span className="text-[11px] text-ink-muted">
                          {attemptResult.is_correct
                            ? "Classifique seu nível de domínio para calibrar a repetição espaçada."
                            : "Questões erradas retornam na próxima semana (D+7) para consolidação clínica."}
                        </span>
                      </div>
                      
                      {attemptResult.is_correct ? (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <button
                            title="Acertei no chute ou com grande insegurança. Intervalo FSRS: ~15 dias."
                            onClick={() => handleReviewFSRS("chutei")}
                            className="bg-warning/10 hover:bg-warning/20 text-ink border border-warning/30 font-bold py-2.5 px-2 rounded-xs transition-colors text-xs flex flex-col items-center justify-center gap-0.5 cursor-pointer font-mono-lab"
                          >
                            <span className="flex items-center gap-1 font-semibold">Chutei</span>
                            <span className="text-[10px] text-ink-muted font-normal">+15 dias • [1]</span>
                          </button>
                          <button
                            title="Raciocínio correto, mas exigiu esforço ou dica. Intervalo FSRS calibrado."
                            onClick={() => handleReviewFSRS("duvida")}
                            className="bg-accent/10 hover:bg-accent/20 text-ink border border-accent/40 shadow-xs font-bold py-2.5 px-2 rounded-xs transition-colors text-xs flex flex-col items-center justify-center gap-0.5 cursor-pointer font-mono-lab ring-1 ring-accent/20"
                          >
                            <span className="flex items-center gap-1 font-semibold">Com Esforço</span>
                            <span className="text-[10px] text-accent font-normal">
                              {attemptResult.assisted || Boolean(attendingTip) ? "+15 dias (c/ dica) • [2]" : "+34 dias • [2]"}
                            </span>
                          </button>
                          {attemptResult.assisted || Boolean(attendingTip) ? (
                            <button
                              title="Como a Dica do Preceptor (/dica) foi consultada antes da resposta, o intervalo máximo é calibrado como Hard (~15 dias)."
                              onClick={() => handleReviewFSRS("certeza")}
                              className="bg-surface-subtle hover:bg-elevated text-ink-secondary border border-line-subtle font-bold py-2.5 px-2 rounded-xs transition-colors text-xs flex flex-col items-center justify-center gap-0.5 cursor-pointer font-mono-lab"
                            >
                              <span className="flex items-center gap-1 font-semibold">Com Ajuda (Máx. Hard)</span>
                              <span className="text-[10px] text-warning font-normal">+15 dias • [3]</span>
                            </button>
                          ) : (
                            <button
                              title="Questão dominada com total convicção. Intervalo FSRS: ~76 dias."
                              onClick={() => handleReviewFSRS("certeza")}
                              className="bg-normal/10 hover:bg-normal/20 text-ink border border-normal/30 font-bold py-2.5 px-2 rounded-xs transition-colors text-xs flex flex-col items-center justify-center gap-0.5 cursor-pointer font-mono-lab"
                            >
                              <span className="flex items-center gap-1 font-semibold">Domino</span>
                              <span className="text-[10px] text-normal font-normal">+76 dias • [3]</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row gap-2">
                          <button
                            title="Agendada para 7 dias no FSRS v6."
                            onClick={() => handleReviewFSRS("duvida")}
                            className="flex-1 bg-critical/10 hover:bg-critical/20 text-critical border border-critical/30 font-bold py-2.5 px-3 rounded-xs transition-colors text-xs flex items-center justify-center gap-2 cursor-pointer font-mono-lab shadow-xs"
                          >
                            <RotateCcw size={14} />
                            <span>Revisar na Próxima Semana</span>
                            <span className="text-[10px] font-normal py-0.5 px-1.5 bg-critical/15 rounded-xs">D+7 • [Enter]</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {isCurator && q && (
        <QuestionClassificationModal
          isOpen={isClassificationModalOpen}
          onClose={() => setIsClassificationModalOpen(false)}
          questionId={q.id}
          currentArea={q.area}
          currentSubtema={q.subtema}
          currentTopic={q.topic}
          onSuccess={(updated) => {
            setCurrentDetail((prev) => (prev ? { ...prev, area: updated.area, subtema: updated.subtema, topic: updated.topic } : prev));
            setQueue((prevQueue) =>
              prevQueue.map((item, idx) =>
                idx === currentIndex ? { ...item, area: updated.area, subtema: updated.subtema, topic: updated.topic } : item
              )
            );
            toast.success("Tema da questão atualizado com sucesso!");
          }}
          onDelete={(deletedId) => {
            setIsClassificationModalOpen(false);
            delete detailsCacheRef.current[deletedId];
            setSessionAnswers((prev) => {
              const copy = { ...prev };
              delete copy[deletedId];
              return copy;
            });
            setQueue((prevQueue) => {
              const newQueue = prevQueue.filter((item) => item.id !== deletedId);
              if (newQueue.length === 0) {
                setState("FINISHED");
                setCurrentDetail(null);
                return [];
              }
              const nextIndex = currentIndex >= newQueue.length ? newQueue.length - 1 : currentIndex;
              setCurrentIndex(nextIndex);
              loadQuestionDetail(newQueue[nextIndex].id);
              return newQueue;
            });
            toast.success(`Questão #${deletedId} excluída com sucesso!`);
          }}
        />
      )}

      {showFinishModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setShowFinishModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="finish-modal-title"
        >
          <div 
            className="bg-surface border border-line-subtle shadow-2xl rounded-lg p-6 max-w-md w-full flex flex-col gap-4 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-accent/10 border border-accent/25 text-accent flex items-center justify-center shrink-0">
                <CheckCircle2 size={18} />
              </div>
              <div>
                <h3 id="finish-modal-title" className="text-base font-bold text-ink-primary">Finalizar Sessão de Estudos?</h3>
                <p className="text-xs text-ink-secondary">Você pode encerrar a sessão a qualquer momento.</p>
              </div>
            </div>

            <div className="bg-elevated/40 rounded-md p-3.5 border border-line-subtle text-xs sm:text-sm text-ink-primary leading-relaxed">
              Você respondeu <strong className="font-mono-lab tabular-nums">{completedCount}</strong> de <strong className="font-mono-lab tabular-nums">{queue.length}</strong> questões. Restam <span className="font-mono-lab tabular-nums">{queue.length - completedCount}</span> não respondidas.
              <p className="mt-2 text-xs text-ink-secondary">
                Todas as questões já respondidas terão suas revisões (FSRS) preservadas. Ao finalizar, você verá seu relatório de acertos e o diagnóstico da sessão.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowFinishModal(false)}
                className="px-4 py-2 rounded-md text-xs font-semibold text-ink-secondary hover:text-ink-primary hover:bg-elevated transition-colors cursor-pointer"
              >
                Continuar Respondendo
              </button>
              <button
                type="button"
                onClick={confirmFinish}
                className="px-4 py-2 rounded-md text-xs font-semibold bg-accent hover:bg-accent/90 text-white shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <CheckCircle2 size={15} />
                Sim, Finalizar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

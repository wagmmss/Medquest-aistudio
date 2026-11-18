import { AttemptResult, QuestionDetail, QuestionListItem } from "@/types/api";

export type QuizState = "FILTERS" | "LOADING_QUEUE" | "PLAYING" | "FINISHED";

export type SessionAnswer = {
  letter: string;
  result?: AttemptResult | null;
  isOffline?: boolean;
  writtenAnswer?: string;
  isDiscursive?: boolean;
  assisted?: boolean;
  attendingTip?: string | null;
};

export interface QuizSessionMachineState {
  phase: QuizState;
  filters: Record<string, string | string[]>;
  queue: QuestionListItem[];
  currentIndex: number;
  sessionAnswers: Record<number, SessionAnswer>;
  eliminatedAlternatives: Record<number, string[]>;
}

export type QuizSessionAction =
  | { type: "START_LOADING"; filters: Record<string, string | string[]> }
  | { type: "QUEUE_LOADED"; queue: QuestionListItem[]; filters: Record<string, string | string[]> }
  | { type: "QUEUE_ABORTED" }
  | {
      type: "RESTORE_SAVED";
      phase: "PLAYING" | "FINISHED";
      queue: QuestionListItem[];
      currentIndex: number;
      filters: Record<string, string | string[]>;
      sessionAnswers: Record<number, SessionAnswer>;
      eliminatedAlternatives?: Record<number, string[]>;
    }
  | { type: "GO_TO_INDEX"; index: number }
  | { type: "RECORD_ANSWER"; questionId: number; answer: SessionAnswer }
  | { type: "TOGGLE_ELIMINATE"; questionId: number; letter: string }
  | { type: "FINISH_SESSION" }
  | { type: "RESTART_SESSION" }
  | { type: "RESET_TO_FILTERS"; defaultFilters?: Record<string, string | string[]> };

export function createInitialQuizSessionState(
  hasExplicitFilters: boolean,
  initialFilters: Record<string, string | string[]> = {}
): QuizSessionMachineState {
  return {
    phase: hasExplicitFilters ? "LOADING_QUEUE" : "FILTERS",
    filters: { limit: "50", status: "unanswered", unanswered_only: "true", ...initialFilters },
    queue: [],
    currentIndex: 0,
    sessionAnswers: {},
    eliminatedAlternatives: {},
  };
}

export function quizSessionReducer(
  state: QuizSessionMachineState,
  action: QuizSessionAction
): QuizSessionMachineState {
  switch (action.type) {
    case "START_LOADING":
      return {
        ...state,
        phase: "LOADING_QUEUE",
        filters: action.filters,
      };
    case "QUEUE_LOADED":
      return {
        ...state,
        phase: action.queue.length > 0 ? "PLAYING" : "FILTERS",
        filters: action.filters,
        queue: action.queue,
        currentIndex: 0,
        sessionAnswers: {},
        eliminatedAlternatives: {},
      };
    case "QUEUE_ABORTED":
      return {
        ...state,
        phase: "FILTERS",
      };
    case "RESTORE_SAVED": {
      const safeIndex =
        action.queue.length > 0
          ? Math.max(0, Math.min(action.currentIndex, action.queue.length - 1))
          : 0;
      return {
        phase: action.phase,
        filters: action.filters,
        queue: action.queue,
        currentIndex: safeIndex,
        sessionAnswers: action.sessionAnswers,
        eliminatedAlternatives: action.eliminatedAlternatives ?? {},
      };
    }
    case "GO_TO_INDEX": {
      if (state.queue.length === 0) return state;
      const bounded = Math.max(0, Math.min(action.index, state.queue.length - 1));
      if (bounded === state.currentIndex) return state;
      return {
        ...state,
        currentIndex: bounded,
      };
    }
    case "RECORD_ANSWER":
      return {
        ...state,
        sessionAnswers: {
          ...state.sessionAnswers,
          [action.questionId]: action.answer,
        },
      };
    case "TOGGLE_ELIMINATE": {
      const existing = state.eliminatedAlternatives[action.questionId] ?? [];
      const next = existing.includes(action.letter)
        ? existing.filter((l) => l !== action.letter)
        : [...existing, action.letter];
      return {
        ...state,
        eliminatedAlternatives: {
          ...state.eliminatedAlternatives,
          [action.questionId]: next,
        },
      };
    }
    case "FINISH_SESSION":
      return {
        ...state,
        phase: "FINISHED",
      };
    case "RESTART_SESSION":
      return {
        ...state,
        phase: state.queue.length > 0 ? "PLAYING" : "FILTERS",
        currentIndex: 0,
        sessionAnswers: {},
        eliminatedAlternatives: {},
      };
    case "RESET_TO_FILTERS":
      return {
        phase: "FILTERS",
        filters: action.defaultFilters ?? { limit: "50", status: "unanswered", unanswered_only: "true" },
        queue: [],
        currentIndex: 0,
        sessionAnswers: {},
        eliminatedAlternatives: {},
      };
    default:
      return state;
  }
}

export function getSavedQuizPayloadMeta(
  currentDetail: QuestionDetail | null,
  state: QuizSessionMachineState
) {
  return {
    phase: state.phase,
    queue: state.queue,
    currentIndex: state.currentIndex,
    filters: state.filters,
    currentDetail,
    sessionAnswers: state.sessionAnswers,
    eliminatedAlternatives: state.eliminatedAlternatives,
  };
}

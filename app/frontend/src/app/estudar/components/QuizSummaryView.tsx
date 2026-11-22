"use client";

import dynamic from "next/dynamic";
import { SessionAnswer } from "../quizSessionReducer";
import type { LessonCycleQuizContext } from "./QuizSessionReportModal";

const QuizSessionReportModal = dynamic(
  () => import("./QuizSessionReportModal").then((m) => m.QuizSessionReportModal),
  { ssr: false }
);

export function QuizLoadingView() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
      <p className="text-ink-secondary text-sm font-medium">Montando sua sessão...</p>
    </div>
  );
}

export function QuizSummaryView({
  sessionAnswers,
  onBackToFilters,
  onRestartSession,
  lessonCycleContext = null,
}: {
  sessionAnswers: Record<number, SessionAnswer>;
  onBackToFilters: () => void;
  onRestartSession: () => void;
  lessonCycleContext?: LessonCycleQuizContext | null;
}) {
  const answeredEntries = Object.entries(sessionAnswers).filter(
    ([, a]) => Boolean(a && (a.result || a.isOffline))
  );
  const totalAnswered = answeredEntries.length;
  const correctCount = answeredEntries.filter(([, a]) => a.result?.is_correct === true).length;
  const assistedCorrectCount = answeredEntries.filter(
    ([, a]) => a.result?.is_correct === true && Boolean(a.assisted || a.result?.assisted)
  ).length;
  const wrongItems = answeredEntries
    .filter(([, ans]) => ans.result?.is_correct === false)
    .map(([qid, ans]) => ({ question_id: Number(qid), wrong_letter: ans.letter }));
  const accuracy = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

  return (
    <QuizSessionReportModal
      totalAnswered={totalAnswered}
      correctCount={correctCount}
      assistedCorrectCount={assistedCorrectCount}
      accuracy={accuracy}
      wrongItems={wrongItems}
      onBackToFilters={onBackToFilters}
      onRestartSession={onRestartSession}
      lessonCycleContext={lessonCycleContext}
    />
  );
}

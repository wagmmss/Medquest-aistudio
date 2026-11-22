import type { Metadata } from "next";
import { Suspense } from "react";
import LessonsClient from "./LessonsClient";

export const metadata: Metadata = {
  title: "Aulas | MedQuest",
  description: "Videoteca privada integrada aos 170 subtemas do MedQuest.",
};

export default function AulasPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-24 rounded-md bg-surface border border-line-subtle animate-pulse" />
          <div className="h-[520px] rounded-md bg-surface border border-line-subtle animate-pulse" />
        </div>
      }
    >
      <LessonsClient />
    </Suspense>
  );
}

import Link from "next/link";
import { getSubtemaDetails } from "@/lib/plannerData";
import { QuizClient } from "./QuizClient";

export default async function EstudarPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const rawParams = await searchParams;

  // Convert searchParams to record of strings or string arrays
  const initialFilters: Record<string, string | string[]> = {};
  for (const key in rawParams) {
    const val = rawParams[key];
    if (typeof val === "string" || Array.isArray(val)) {
      initialFilters[key] = val;
    }
  }

  const subtemaStr = typeof initialFilters.subtema === "string" ? initialFilters.subtema : undefined;

  return (
    <div className="animate-in fade-in duration-500 w-full h-full">
      {subtemaStr && getSubtemaDetails(subtemaStr) && (
        <Link href={`/analise?tab=cobertura&subtema=${encodeURIComponent(subtemaStr)}`} className="inline-block mb-4 text-xs font-semibold text-accent hover:underline">
          ← Voltar ao tema
        </Link>
      )}
      <QuizClient 
        initialFilters={initialFilters}
      />
    </div>
  );
}

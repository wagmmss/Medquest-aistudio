"use client";

import Link from "next/link";
import type { AtRiskTopic } from "@/types/api";

interface FsrsAndWeakTopicsGridProps {
  atRiskTopics: AtRiskTopic[];
}

export function FsrsAndWeakTopicsGrid({
  atRiskTopics,
}: FsrsAndWeakTopicsGridProps) {
  const visibleAtRisk = atRiskTopics?.slice(0, 5) ?? [];

  return (
    <section className="bg-surface border border-line-subtle rounded-lg p-6 flex flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-lg text-ink-primary">Radar de Esquecimento (FSRS)</h3>
          <p className="text-xs text-ink-muted mt-1">
            Top {visibleAtRisk.length || 5} subtemas com questões mais próximas do limiar de retenção programada.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleAtRisk.length > 0 ? (
          visibleAtRisk.map((topic, idx) => (
            <Link
              key={`${topic.subtema}-${idx}`}
              href={`/estudar?subtema=${encodeURIComponent(topic.subtema)}&status=srs_due&limit=20`}
              className="flex items-center justify-between p-3 bg-canvas rounded-md border border-line-subtle hover:border-warning/50 transition-colors"
            >
              <div className="flex flex-col min-w-0 pr-3">
                <span
                  className="font-medium text-sm text-ink-primary leading-tight truncate"
                  title={topic.subtema}
                >
                  {topic.subtema}
                </span>
                <span className="text-xs text-ink-muted mt-0.5 font-mono-lab tabular-nums">
                  {topic.items_count} {topic.items_count === 1 ? "questão em risco" : "questões em risco"}
                </span>
              </div>
              <div className="flex flex-col items-end shrink-0 gap-1">
                <span className="text-xs font-mono-lab tabular-nums font-semibold text-warning">
                  {topic.retrievability !== undefined
                    ? `${Math.round(topic.retrievability * 100)}% retenção`
                    : "Baixa retenção"}
                </span>
                <span className="text-[11px] font-semibold text-accent">
                  Treinar →
                </span>
              </div>
            </Link>
          ))
        ) : (
          <div className="col-span-full min-h-[120px] flex items-center justify-center text-xs text-ink-muted text-center p-4 border border-dashed border-line-subtle rounded-md">
            Nenhuma questão com risco elevado de esquecimento no momento.
          </div>
        )}
      </div>
    </section>
  );
}

import type { AnalysisSummaryResponse } from "@/types/api";
import dynamic from "next/dynamic";
import type { AnalysisTabKey } from "./AnalysisClient";

const AnalysisClient = dynamic(
  () => import("./AnalysisClient").then((mod) => mod.AnalysisClient),
  {
    loading: () => (
      <div className="flex flex-col gap-6">
        <div className="h-12 bg-surface-subtle border border-line-subtle rounded-lg w-80" />
        <div className="h-64 bg-surface-subtle border border-line-subtle rounded-lg w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-48 bg-surface-subtle border border-line-subtle rounded-lg" />
          <div className="h-48 bg-surface-subtle border border-line-subtle rounded-lg" />
        </div>
      </div>
    ),
  }
);

const ALLOWED_INSTITUTIONS = [
  { key: "USP-SP", label: "USP - São Paulo" },
  { key: "USP-RP", label: "USP - Ribeirão Preto" },
  { key: "UNICAMP", label: "Unicamp" },
  { key: "UNIFESP", label: "Unifesp / EPM" },
  { key: "SUS-SP", label: "SUS-SP" },
];

const EMPTY_SUMMARY: AnalysisSummaryResponse = {
  overview: {
    total_questions: 0,
    distinct_answered: 0,
    total_attempts: 0,
    accuracy_all_attempts: null,
    accuracy_latest_attempt: null,
    coverage_pct: null,
    srs_due_count: 0,
    accuracy_last7: null,
    accuracy_prev7: null,
    streak_days: 0,
  },
  learning_profile: {
    generated_at: "",
    goal: {
      questions_today: 30,
      configured_daily_questions: 30,
      reviews_due: 0,
      reviews_to_do_today: 0,
      backlog_pending: 0,
      hours_budget: 4,
      max_capacity: 80,
      target_score: null,
      exam_date: null,
    },
    topics: [],
    method: { deterministic: true, signals: [] },
  },
  exam_readiness: {
    institution: "USP-SP",
    coverage: 0,
    answered: 0,
    available: 0,
    areas: [],
    disclaimer: "Ainda não há dados suficientes para este relatório.",
    limitations: [
      "A prontidão estimada reflete exclusivamente as questões resolvidas no MedQuest sob o perfil de edital configurado.",
      "Não constitui probabilidade de aprovação, garantia de classificação ou nota de corte oficial.",
    ],
  },
  institution_radar: {
    institution: {
      code: "USP-SP",
      label: "USP - São Paulo",
      total_available: 0,
      total_answered: 0,
      coverage: 0,
      total_attempts: 0,
      total_correct: 0,
      accuracy: null,
      ci_lower: null,
      ci_upper: null,
      sample_status: "insufficient",
      areas: [],
    },
    comparison: {
      type: "global",
      code: null,
      label: "Desempenho Geral",
      total_available: 0,
      total_answered: 0,
      coverage: 0,
      total_attempts: 0,
      total_correct: 0,
      accuracy: null,
      ci_lower: null,
      ci_upper: null,
      sample_status: "insufficient",
      areas: [],
    },
    disclaimer:
      "Métricas isoladas exclusivamente para sua conta. Intervalos de incerteza calculados via Wilson Score a 95% de confiança estatística.",
    sample_thresholds: {
      insufficient: "< 20 tentativas",
      forming: "20 a 49 tentativas",
      reliable: "≥ 50 tentativas",
    },
  },
  blindspots: {
    summary: {
      total_blindspots: 0,
      unresolved_errors_count: 0,
      healed_count: 0,
      healing_rate_pct: 0,
      total_unique_answered: 0,
    },
    blindspots: [],
  },
  weak_topics: [],
  distractors: [],
  at_risk: [],
  timeline_180: [],
  coverage: { areas: [] },
};

export default async function AnalisePage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[];
    subtema?: string | string[];
    institution?: string | string[];
    compare_institution?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const rawTab = typeof params?.tab === "string" ? params.tab : undefined;
  const rawSubtema = typeof params?.subtema === "string" ? params.subtema : null;
  const rawInst =
    typeof params?.institution === "string" ? params.institution : undefined;
  const rawCompare =
    typeof params?.compare_institution === "string"
      ? params.compare_institution
      : undefined;

  const initialTab: AnalysisTabKey =
    rawTab === "cobertura" || rawSubtema
      ? "cobertura"
      : rawTab === "prontidao"
      ? "prontidao"
      : rawTab === "sniper"
      ? "sniper"
      : "desempenho";

  return (
    <div className="flex flex-col gap-6">
      <section className="bg-surface border border-line-subtle rounded-lg p-6 md:p-7">
        <span className="inline-block text-[11px] font-mono-lab uppercase tracking-wider text-primary font-semibold mb-2">
          Análise adaptativa
        </span>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight mb-2">
          Análise de Desempenho & Cobertura
        </h1>
        <p className="text-muted-foreground text-sm md:text-base max-w-2xl leading-relaxed">
          Evidências transparentes para decidir o que estudar: radar comparativo de
          bancas, cobertura modular do edital, risco de esquecimento e prontidão
          bayesiana.
        </p>
      </section>

      <AnalysisClient
        initialSummary={EMPTY_SUMMARY}
        institutionOptions={ALLOWED_INSTITUTIONS}
        initialTab={initialTab}
        initialSubtema={rawSubtema}
        initialInstitution={rawInst}
        initialCompare={rawCompare}
      />
    </div>
  );
}

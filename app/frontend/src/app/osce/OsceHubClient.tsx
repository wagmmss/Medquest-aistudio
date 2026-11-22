"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { 
  Stethoscope, Clock, Award, AlertCircle, 
  CheckCircle2, ChevronRight, Play, Sparkles, Filter,
  Loader2, RotateCcw
} from "lucide-react";
import { OsceStation } from "@/types/api";
import { api } from "@/lib/api";

interface OsceHubClientProps {
  initialStations?: OsceStation[];
}

const INSTITUTIONS = [
  "Todas as Bancas",
  "USP-RP",
  "UNICAMP",
  "UNIFESP",
  "Einstein",
  "Revalida INEP",
  "SCMSP"
];

const AREAS = [
  "Todas as Áreas",
  "Clínica Médica",
  "Cirurgia Geral",
  "Pediatria",
  "Ginecologia e Obstetrícia",
  "Medicina Preventiva"
];

export function OsceHubClient({ initialStations = [] }: OsceHubClientProps) {
  const router = useRouter();
  const { data: stationsData, isLoading: isLoadingStations } = useQuery({
    queryKey: ["osce-stations"],
    queryFn: () => api.osce.getStations(),
    initialData: initialStations.length > 0 ? { stations: initialStations, count: initialStations.length } : undefined,
    staleTime: 120_000,
  });
  const stations = useMemo(() => stationsData?.stations ?? initialStations, [stationsData, initialStations]);
  const [selectedInst, setSelectedInst] = useState<string>("Todas as Bancas");
  const [selectedArea, setSelectedArea] = useState<string>("Todas as Áreas");
  const [activeTab, setActiveTab] = useState<"avulso" | "circuito">("avulso");

  const filteredStations = useMemo(() => {
    return stations.filter((st) => {
      const matchInst = selectedInst === "Todas as Bancas" || st.institution === selectedInst;
      const matchArea = selectedArea === "Todas as Áreas" || st.area === selectedArea;
      return matchInst && matchArea;
    });
  }, [stations, selectedInst, selectedArea]);

  const stats = useMemo(() => {
    const completed = stations.filter(s => s.completed_attempts > 0);
    const avgScore = completed.length > 0 
      ? completed.reduce((acc, s) => acc + (s.best_score || 0), 0) / completed.length 
      : 0;
    return {
      total: stations.length,
      completed: completed.length,
      avgScore: avgScore.toFixed(1)
    };
  }, [stations]);

  const [isStartingCircuit, setIsStartingCircuit] = useState(false);
  const [circuitError, setCircuitError] = useState<string | null>(null);

  // Iniciar circuito real de 5 estações (sem fallback falso)
  const handleStartCircuit = async () => {
    if (isStartingCircuit) return;
    setIsStartingCircuit(true);
    setCircuitError(null);
    try {
      const targetInst = selectedInst !== "Todas as Bancas" ? selectedInst : "USP-RP";
      const plan = await api.osce.getCircuitPlan(targetInst);
      if (plan?.stations && plan.stations.length > 0) {
        const first = plan.stations[0];
        router.push(`/osce/${first.station_id}?circuit=${plan.circuit_id}&step=1`);
      } else {
        setCircuitError("Não foi possível montar o circuito oficial com as estações disponíveis para esta banca.");
      }
    } catch (err) {
      console.error("Falha ao iniciar circuito:", err);
      setCircuitError(err instanceof Error ? err.message : "Erro ao carregar o circuito oficial de 5 estações.");
    } finally {
      setIsStartingCircuit(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-300">
      {/* Header com Branding Clínico de 2ª Fase */}
      <div className="mq-page-hero p-6 md:p-8 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-semibold border border-accent/20">
              <Stethoscope className="w-3.5 h-3.5" />
              <span>Simulador Oficial de 2ª Fase Prática (OSCE)</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-ink-primary">
              Arena OSCE &amp; Beira-Leito
            </h1>
            <p className="text-ink-secondary text-sm max-w-2xl leading-relaxed">
              Treinamento de estações clínicas com paciente virtual falante, estetoscópio interativo, 
              exames complementares reais e <strong>Espelho de Correção Oficial</strong> das bancas 
              com 2ª fase presencial (<span className="text-ink-primary font-medium">UNICAMP, UNIFESP, Einstein, Revalida INEP, SCMSP e USP-RP</span>).
            </p>
          </div>

          {/* Métricas Clínicas */}
          <div className="grid grid-cols-3 gap-2 shrink-0 bg-surface p-3 rounded-2xl border border-line-subtle shadow-2xs">
            <div className="text-center px-3 py-1">
              <div className="text-xl md:text-2xl font-bold font-mono-lab tabular-nums text-ink-primary">{stats.total}</div>
              <div className="text-[11px] font-medium text-ink-secondary">Estações</div>
            </div>
            <div className="text-center px-3 py-1 border-x border-line-subtle">
              <div className="text-xl md:text-2xl font-bold font-mono-lab tabular-nums text-accent">{stats.completed}</div>
              <div className="text-[11px] font-medium text-ink-secondary">Feitas</div>
            </div>
            <div className="text-center px-3 py-1">
              <div className="text-xl md:text-2xl font-bold font-mono-lab tabular-nums text-emerald-500">
                {stats.completed > 0 ? stats.avgScore : "—"}
              </div>
              <div className="text-[11px] font-medium text-ink-secondary">Média</div>
            </div>
          </div>
        </div>

        {/* Tab Selector: Treino Avulso vs Circuito Oficial */}
        <div className="flex items-center gap-2 mt-6 border-t border-line-subtle pt-5">
          <button
            onClick={() => setActiveTab("avulso")}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === "avulso"
                ? "bg-ink-primary text-canvas shadow-xs"
                : "bg-surface text-ink-secondary hover:text-ink-primary border border-line-subtle"
            }`}
          >
            Treino Avulso por Estação
          </button>
          <button
            onClick={() => setActiveTab("circuito")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xs text-xs font-mono-lab font-semibold transition-colors cursor-pointer ${
              activeTab === "circuito"
                ? "bg-ink-primary text-canvas shadow-xs"
                : "bg-canvas text-ink-secondary hover:text-ink-primary border border-line-subtle"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Circuito de Prova (5 Estações)</span>
          </button>
        </div>
      </div>

      {/* Seção Circuito de Prova */}
      {activeTab === "circuito" && (
        <div className="rounded-lg border border-amber-500/30 bg-surface p-5 md:p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 text-amber-500 text-xs font-mono-lab uppercase font-bold">
                <Award className="w-3.5 h-3.5" />
                <span>Simulação do Dia da Prova Presencial</span>
              </div>
              <h2 className="text-xl font-bold text-ink-primary">Circuito de Rotação Completo</h2>
              <p className="text-ink-secondary text-xs md:text-sm max-w-2xl leading-relaxed">
                Você enfrentará 5 estações seguidas (Clínica Médica, Cirurgia Geral, Pediatria, Ginecologia/Obstetrícia e Preventiva). 
                Ao fim de cada 8 minutos, o sino toca e você roda para a próxima sala. Ao final, receba o barema global da sua 2ª Fase (0 a 50 pontos).
              </p>
            </div>
            <button
              onClick={handleStartCircuit}
              disabled={isStartingCircuit}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md font-mono-lab text-xs font-bold bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white transition-colors shrink-0 cursor-pointer"
            >
              {isStartingCircuit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              <span>{isStartingCircuit ? "Montando Circuito Oficial..." : "Entrar no Circuito Oficial"}</span>
            </button>
          </div>
          {circuitError && (
            <div className="p-3 rounded-md bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-3 text-xs text-rose-500">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{circuitError}</span>
              </div>
              <button
                type="button"
                onClick={handleStartCircuit}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-500 text-white font-semibold hover:bg-rose-600 cursor-pointer shrink-0"
              >
                <RotateCcw className="w-3 h-3" /> Tentar novamente
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filtros de Bancas e Especialidades */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-mono-lab font-semibold text-ink-tertiary uppercase tracking-wider">
          <Filter className="w-3.5 h-3.5" />
          <span>Filtrar por Banca Oficial com 2ª Fase</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {INSTITUTIONS.map((inst) => (
            <button
              key={inst}
              onClick={() => setSelectedInst(inst)}
              className={`px-3 py-1 rounded-md text-xs font-mono-lab transition-colors cursor-pointer border ${
                selectedInst === inst
                  ? "bg-ink-primary text-canvas border-ink-primary font-bold"
                  : "bg-surface text-ink-secondary border-line-subtle hover:border-line-crisp"
              }`}
            >
              {inst}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1">
          {AREAS.map((area) => (
            <button
              key={area}
              onClick={() => setSelectedArea(area)}
              className={`px-3 py-1 rounded-md text-xs font-mono-lab transition-colors cursor-pointer border ${
                selectedArea === area
                  ? "bg-accent text-white border-accent font-bold"
                  : "bg-surface text-ink-secondary border-line-subtle hover:border-line-crisp"
              }`}
            >
              {area}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de Estações */}
      {isLoadingStations && stations.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true" aria-label="Carregando estações OSCE">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-48 rounded-lg border border-line-subtle bg-surface animate-pulse p-4 space-y-3"
            >
              <div className="h-5 w-24 rounded bg-surface-subtle" />
              <div className="h-5 w-3/4 rounded bg-surface-subtle" />
              <div className="h-4 w-1/2 rounded bg-surface-subtle" />
            </div>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredStations.map((station) => {
          const isPassed = station.best_score !== null && station.best_score >= 7.0;

          return (
            <div
              key={station.id}
              className="group flex flex-col justify-between rounded-lg border border-line-subtle bg-surface hover:border-line-crisp transition-colors overflow-hidden"
            >
              <div className="p-4 space-y-3">
                {/* Header do Card */}
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2 py-0.5 rounded-md text-xs font-mono-lab font-semibold uppercase bg-canvas border border-line-subtle text-ink-secondary">
                    {station.institution}
                  </span>
                  <div className="flex items-center gap-1 text-xs font-mono-lab tabular-nums text-ink-tertiary">
                    <Clock className="w-3 h-3" />
                    <span>{Math.round(station.duration_seconds / 60)} min</span>
                  </div>
                </div>

                {/* Título & Subtema */}
                <div>
                  <h3 className="text-sm font-semibold text-ink-primary group-hover:text-accent transition-colors line-clamp-2">
                    {station.title}
                  </h3>
                  <p className="text-xs text-ink-secondary mt-1 font-mono-lab">
                    {station.area} • {station.subtema}
                  </p>
                </div>

                {/* Score Status */}
                <div className="pt-2 border-t border-line-subtle flex items-center justify-between text-xs font-mono-lab">
                  <span className="text-ink-tertiary">Desempenho Barema:</span>
                  {station.best_score !== null ? (
                    <span className={`font-bold tabular-nums flex items-center gap-1 ${
                      isPassed ? "text-emerald-500" : "text-rose-500"
                    }`}>
                      {isPassed ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      {station.best_score.toFixed(1)} / 10.0
                    </span>
                  ) : (
                    <span className="text-ink-tertiary/70 italic text-[11px]">Não realizada</span>
                  )}
                </div>
              </div>

              {/* Botão de Entrada */}
              <div className="p-2.5 bg-canvas border-t border-line-subtle">
                <Link
                  href={`/osce/${station.id}`}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xs text-xs font-mono-lab font-semibold bg-accent/10 hover:bg-accent hover:text-white text-accent border border-accent/20 transition-colors shadow-xs"
                >
                  <span>Abrir Porta da Estação</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {!isLoadingStations && filteredStations.length === 0 && (
        <div className="text-center py-12 border border-dashed border-line-subtle rounded-sm p-6 bg-surface">
          <AlertCircle className="w-8 h-8 text-ink-tertiary mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-ink-primary font-mono-lab">Nenhuma estação encontrada</h3>
          <p className="text-xs text-ink-secondary mt-1">
            Tente selecionar outros filtros de bancas ou grandes áreas.
          </p>
        </div>
      )}
    </div>
  );
}

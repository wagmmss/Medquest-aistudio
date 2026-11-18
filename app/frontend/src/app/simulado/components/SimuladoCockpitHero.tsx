"use client";

import React from "react";
import { Award, CheckCircle2, Clock, Zap, WifiOff } from "lucide-react";

interface SimuladoCockpitHeroProps {
  completedCount: number;
  averageAccuracy: number;
  totalTimeHours: number;
  isOffline: boolean;
  hasOfflinePackage: boolean;
}

export const SimuladoCockpitHero: React.FC<SimuladoCockpitHeroProps> = ({
  completedCount,
  averageAccuracy,
  totalTimeHours,
  isOffline,
  hasOfflinePackage,
}) => {
  return (
    <div className="w-full mb-6">
      <div className="mq-page-hero p-5 sm:p-6 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <span className="inline-block text-xs font-semibold text-accent">
              Arena de Simulados · R1 São Paulo
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold text-ink-primary tracking-tight">
              Simulados Oficiais &amp; Treinamento Estratégico
            </h1>
            <p className="text-ink-secondary text-sm leading-relaxed">
              Treine em condições idênticas às grandes bancas de São Paulo (USP-SP, USP-RP, UNICAMP, UNIFESP e SUS-SP) com cronometragem oficial, Teoria de Resposta ao Item (TRI) e cadernos balanceados por especialidade.
            </p>
          </div>

          <div className="flex md:flex-col items-start md:items-end gap-2 shrink-0">
            {isOffline ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning/15 text-warning border border-warning/30 text-xs font-semibold">
                <WifiOff size={14} /> Modo Plantão Offline
              </span>
            ) : hasOfflinePackage ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-success/15 text-success border border-success/30 text-xs font-semibold">
                <CheckCircle2 size={14} /> Pacote Offline Pronto
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 text-accent border border-accent/20 text-xs font-semibold">
                Sincronizado na Nuvem
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-5 border-t border-line-subtle">
          <div className="bg-surface border border-line-subtle rounded-2xl p-3.5 flex items-center gap-3 shadow-2xs">
            <div className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <Award size={18} />
            </div>
            <div>
              <p className="text-xs text-ink-secondary font-medium">Simulados Feitos</p>
              <p className="text-lg font-bold text-ink-primary font-mono-lab tabular-nums">{completedCount}</p>
            </div>
          </div>

          <div className="bg-surface border border-line-subtle rounded-2xl p-3.5 flex items-center gap-3 shadow-2xs">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <p className="text-xs text-ink-secondary font-medium">Acurácia Média</p>
              <p className="text-lg font-bold text-ink-primary font-mono-lab tabular-nums">
                {averageAccuracy > 0 ? `${averageAccuracy.toFixed(1)}%` : "—"}
              </p>
            </div>
          </div>

          <div className="bg-surface border border-line-subtle rounded-2xl p-3.5 flex items-center gap-3 shadow-2xs">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Clock size={18} />
            </div>
            <div>
              <p className="text-xs text-ink-secondary font-medium">Horas de Prova</p>
              <p className="text-lg font-bold text-ink-primary font-mono-lab tabular-nums">
                {totalTimeHours > 0 ? `${totalTimeHours.toFixed(1)}h` : "0h"}
              </p>
            </div>
          </div>

          <div className="bg-surface border border-line-subtle rounded-2xl p-3.5 flex items-center gap-3 shadow-2xs">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Zap size={18} />
            </div>
            <div>
              <p className="text-xs text-ink-secondary font-medium">Foco Curricular</p>
              <p className="text-sm font-bold text-ink-primary truncate">5 Grandes Áreas</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

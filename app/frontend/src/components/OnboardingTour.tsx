"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, ChartNoAxesCombined, GraduationCap, X } from "lucide-react";

const STORAGE_KEY = "medquest_onboarding_v1";
const STEPS = [
  {
    title: "Estude com direção",
    description: "Use Estudar para filtrar questões ou iniciar uma sessão adaptativa baseada no seu histórico.",
    icon: GraduationCap,
  },
  {
    title: "Revise no momento certo",
    description: "O FSRS agenda revisões e o painel mostra os temas com maior risco de esquecimento.",
    icon: Brain,
  },
  {
    title: "Acompanhe o progresso",
    description: "Análise e Cobertura transformam suas tentativas em metas e prioridades transparentes.",
    icon: ChartNoAxesCombined,
  },
];

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  const finish = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "done");
    setOpen(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (localStorage.getItem(STORAGE_KEY) !== "done") setOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector<HTMLElement>("button");
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled])"));
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, finish]);

  if (!open) return null;
  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/55 p-0 sm:p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
        className="w-full sm:max-w-lg rounded-t-lg sm:rounded-lg border border-line-subtle bg-surface p-6 sm:p-8 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-md border border-accent/25 bg-accent/10 text-accent" aria-hidden="true">
            <Icon size={22} />
          </div>
          <button onClick={finish} className="min-h-10 min-w-10 rounded-md text-ink-muted hover:bg-elevated hover:text-ink-primary transition-colors cursor-pointer" aria-label="Pular apresentação">
            <X className="mx-auto" size={18} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-5 font-mono-lab text-xs font-semibold uppercase tracking-wider text-accent">Passo {step + 1} de {STEPS.length}</p>
        <h2 id="onboarding-title" className="mt-1.5 text-xl font-bold text-ink-primary tracking-tight">{current.title}</h2>
        <p id="onboarding-description" className="mt-2.5 text-sm leading-relaxed text-ink-secondary">{current.description}</p>

        <div className="mt-6 flex gap-2" aria-label="Progresso da apresentação">
          {STEPS.map((item, index) => (
            <span key={item.title} className={`h-1.5 flex-1 rounded-xs ${index <= step ? "bg-accent" : "bg-elevated"}`} aria-hidden="true" />
          ))}
        </div>

        <div className="mt-7 flex items-center justify-between gap-3">
          <button onClick={finish} className="min-h-10 rounded-md px-4 text-xs font-semibold text-ink-secondary hover:bg-elevated transition-colors cursor-pointer">Pular</button>
          <button
            onClick={() => step === STEPS.length - 1 ? finish() : setStep((value) => value + 1)}
            className="min-h-10 rounded-md bg-accent px-5 text-xs font-semibold text-white hover:bg-accent/90 transition-colors cursor-pointer"
          >
            {step === STEPS.length - 1 ? "Começar" : "Próximo"}
          </button>
        </div>
      </div>
    </div>
  );
}

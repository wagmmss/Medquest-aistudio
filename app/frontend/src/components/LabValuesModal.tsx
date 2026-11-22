"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FlaskConical, Search, X } from "lucide-react";

interface LabItem {
  name: string;
  category: string;
  reference: string;
  note?: string;
}

const LAB_CATEGORIES = [
  "Todos",
  "Hemograma",
  "Eletrólitos & Renal",
  "Gasometria",
  "Hepático & Pâncreas",
  "Coagulação & Inflamação",
  "Líquor & Urina",
] as const;

const LAB_VALUES: LabItem[] = [
  // Hemograma
  { name: "Hemoglobina (Hb)", category: "Hemograma", reference: "H: 13,5–17,5 g/dL | M: 12,0–15,5 g/dL" },
  { name: "Hematócrito (Ht)", category: "Hemograma", reference: "H: 41–50% | M: 36–44%" },
  { name: "VCM", category: "Hemograma", reference: "80–100 fL" },
  { name: "HCM / CHCM", category: "Hemograma", reference: "HCM: 27–33 pg | CHCM: 32–36 g/dL" },
  { name: "RDW", category: "Hemograma", reference: "11,5–14,5%" },
  { name: "Reticulócitos", category: "Hemograma", reference: "0,5–2,0% (25.000–75.000/mm³)" },
  { name: "Leucócitos totais", category: "Hemograma", reference: "4.000–11.000/mm³", note: "Bastões até 5%" },
  { name: "Plaquetas", category: "Hemograma", reference: "150.000–450.000/mm³" },
  { name: "Ferritina", category: "Hemograma", reference: "30–300 ng/mL (H) | 15–150 ng/mL (M)" },

  // Eletrólitos & Renal
  { name: "Sódio (Na+)", category: "Eletrólitos & Renal", reference: "135–145 mEq/L" },
  { name: "Potássio (K+)", category: "Eletrólitos & Renal", reference: "3,5–5,0 mEq/L" },
  { name: "Cloro (Cl-)", category: "Eletrólitos & Renal", reference: "98–106 mEq/L" },
  { name: "Cálcio total / iônico", category: "Eletrólitos & Renal", reference: "Total: 8,5–10,5 mg/dL | Iônico: 1,15–1,32 mmol/L" },
  { name: "Magnésio (Mg2+)", category: "Eletrólitos & Renal", reference: "1,7–2,2 mg/dL" },
  { name: "Fósforo (P)", category: "Eletrólitos & Renal", reference: "2,5–4,5 mg/dL" },
  { name: "Creatinina", category: "Eletrólitos & Renal", reference: "0,7–1,3 mg/dL (H) | 0,6–1,1 mg/dL (M)" },
  { name: "Ureia", category: "Eletrólitos & Renal", reference: "15–40 mg/dL" },
  { name: "Glicemia de jejum", category: "Eletrólitos & Renal", reference: "70–99 mg/dL", note: "DM ≥ 126 mg/dL" },

  // Gasometria
  { name: "pH arterial", category: "Gasometria", reference: "7,35–7,45" },
  { name: "PaCO2", category: "Gasometria", reference: "35–45 mmHg" },
  { name: "PaO2", category: "Gasometria", reference: "80–100 mmHg" },
  { name: "Bicarbonato (HCO3-)", category: "Gasometria", reference: "22–26 mEq/L" },
  { name: "Base Excess (BE)", category: "Gasometria", reference: "-2 a +2 mEq/L" },
  { name: "Lactato arterial", category: "Gasometria", reference: "0,5–1,6 mmol/L (< 18 mg/dL)" },
  { name: "Ânion Gap (AG)", category: "Gasometria", reference: "8–12 mEq/L", note: "Na - (Cl + HCO3)" },

  // Hepático & Pâncreas
  { name: "TGO (AST) / TGP (ALT)", category: "Hepático & Pâncreas", reference: "Até 40 U/L" },
  { name: "Fosfatase Alcalina (FA)", category: "Hepático & Pâncreas", reference: "40–130 U/L" },
  { name: "Gama-GT (GGT)", category: "Hepático & Pâncreas", reference: "H: 10–71 U/L | M: 6–42 U/L" },
  { name: "Bilirrubina Total", category: "Hepático & Pâncreas", reference: "0,2–1,2 mg/dL", note: "BD ≤ 0,3 | BI ≤ 0,9" },
  { name: "Albumina sérica", category: "Hepático & Pâncreas", reference: "3,5–5,0 g/dL" },
  { name: "Amilase / Lipase", category: "Hepático & Pâncreas", reference: "Amilase: 30–110 U/L | Lipase: 10–140 U/L" },

  // Coagulação & Inflamação
  { name: "TP / INR", category: "Coagulação & Inflamação", reference: "INR: 0,8–1,2 | Atividade: 70–100%" },
  { name: "TTPa", category: "Coagulação & Inflamação", reference: "25–35 s (Relação paciente/controle < 1,25)" },
  { name: "Fibrinogênio", category: "Coagulação & Inflamação", reference: "200–400 mg/dL" },
  { name: "D-dímero", category: "Coagulação & Inflamação", reference: "< 500 ng/mL FEU (ajustar por idade > 50a)" },
  { name: "PCR (Proteína C Reativa)", category: "Coagulação & Inflamação", reference: "< 5 mg/L (< 0,5 mg/dL)" },
  { name: "VHS", category: "Coagulação & Inflamação", reference: "H: < 15 mm/h | M: < 20 mm/h" },
  { name: "Troponina I / T (alta sens.)", category: "Coagulação & Inflamação", reference: "< p99 do método (geralmente < 14–19 ng/L)" },

  // Líquor & Urina
  { name: "Líquor (LCR) — Células", category: "Líquor & Urina", reference: "0–4 células/mm³ (predomínio linfomononuclear)" },
  { name: "Líquor (LCR) — Proteínas", category: "Líquor & Urina", reference: "15–45 mg/dL" },
  { name: "Líquor (LCR) — Glicose", category: "Líquor & Urina", reference: "50–80 mg/dL (~2/3 da glicemia sérica)" },
  { name: "Urina I — Leucócitos / Hemácias", category: "Líquor & Urina", reference: "< 10.000/mL (< 5–10/campo)" },
  { name: "Proteinúria 24h", category: "Líquor & Urina", reference: "< 150 mg/24h", note: "Nefrótica ≥ 3,5 g/24h" },
];

interface LabValuesModalProps {
  open: boolean;
  onClose: () => void;
}

export const LabValuesModal: React.FC<LabValuesModalProps> = ({ open, onClose }) => {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("Todos");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return LAB_VALUES.filter((item) => {
      if (selectedCategory !== "Todos" && item.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.reference.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.note && item.note.toLowerCase().includes(q))
      );
    });
  }, [query, selectedCategory]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Valores de Referência Laboratoriais"
    >
      <div
        className="w-full max-w-2xl max-h-[85dvh] bg-surface border border-line-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line-subtle flex items-center justify-between gap-3 bg-canvas/50">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
              <FlaskConical size={16} />
            </span>
            <div>
              <h2 className="text-base font-bold text-ink-primary">Valores de Referência</h2>
              <p className="text-xs text-ink-secondary">Consulta rápida offline durante a resolução</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar valores de referência"
            className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xl text-ink-muted hover:text-ink-primary hover:bg-elevated transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 border-b border-line-subtle space-y-3">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              aria-label="Buscar exame laboratorial por nome ou sigla"
              placeholder="Buscar exame (ex: sódio, pH, troponina, líquor, VCM)..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-canvas border border-line-subtle rounded-xl text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {LAB_CATEGORIES.map((cat) => {
              const active = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  aria-pressed={active}
                  className={`min-h-[36px] px-3 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active
                      ? "bg-accent text-white"
                      : "bg-canvas text-ink-secondary hover:text-ink-primary border border-line-subtle"
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-line-subtle">
          {filtered.length > 0 ? (
            filtered.map((item) => (
              <div
                key={item.name}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 hover:bg-elevated/40 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-primary">{item.name}</p>
                  <p className="text-[11px] text-ink-muted">
                    {item.category}
                    {item.note ? ` · ${item.note}` : ""}
                  </p>
                </div>
                <span className="text-xs font-mono-lab tabular-nums font-semibold text-accent bg-accent/10 px-2.5 py-1 rounded-lg border border-accent/20 shrink-0 w-fit">
                  {item.reference}
                </span>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-sm text-ink-muted">
              Nenhum exame encontrado para &ldquo;{query}&rdquo;.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

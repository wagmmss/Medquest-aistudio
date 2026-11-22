"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Highlighter, Save, StickyNote, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { HighlightColor, QuestionHighlight } from "@/types/api";

const COLOR_STYLES: Record<HighlightColor, string> = {
  yellow: "bg-warning/20 border-warning/40 text-ink-primary",
  green: "bg-normal/15 border-normal/40 text-ink-primary",
  pink: "bg-critical/15 border-critical/40 text-ink-primary",
  blue: "bg-accent/15 border-accent/40 text-ink-primary",
};

function QuestionNotePanelInner({ questionId }: { questionId: number }) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [draftHighlights, setDraftHighlights] = useState<QuestionHighlight[] | null>(null);
  const [activeColor, setActiveColor] = useState<HighlightColor>("yellow");

  const { data } = useQuery({
    queryKey: ["question-note", questionId],
    queryFn: () => api.notes.getByQuestion(questionId),
    staleTime: 60_000,
  });

  const noteText = draftNote ?? data?.note_text ?? "";
  const highlights = draftHighlights ?? data?.highlights ?? [];

  const saveMutation = useMutation({
    mutationFn: (payload: { highlights: QuestionHighlight[]; note_text: string }) =>
      api.notes.save(questionId, payload),
    onSuccess: (saved) => {
      queryClient.setQueryData(["question-note", questionId], saved);
      setDraftNote(null);
      setDraftHighlights(null);
      void queryClient.invalidateQueries({ queryKey: ["smart-notebook"] });
      toast.success("Salvo no Caderno Inteligente.");
    },
    onError: () => {
      toast.error("Erro ao salvar anotação.");
    },
  });

  const handleHighlightSelection = () => {
    const selected = window.getSelection()?.toString().trim() || "";
    if (selected.length < 3) {
      toast("Selecione um trecho do enunciado para grifar.");
      return;
    }
    if (highlights.some((h) => h.text === selected)) {
      toast("Esse trecho já está grifado.");
      return;
    }
    const next: QuestionHighlight[] = [
      ...highlights,
      { id: `hl-${Date.now()}`, text: selected.slice(0, 500), color: activeColor },
    ];
    setDraftHighlights(next);
    setIsOpen(true);
    saveMutation.mutate({ highlights: next, note_text: noteText });
  };

  const removeHighlight = (id: string) => {
    const next = highlights.filter((h) => h.id !== id);
    setDraftHighlights(next);
    saveMutation.mutate({ highlights: next, note_text: noteText });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (e.key.toLowerCase() === "m" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const selected = window.getSelection()?.toString().trim() || "";
        if (selected.length >= 3) {
          e.preventDefault();
          handleHighlightSelection();
        }
      } else if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const hasSavedContent = noteText.trim().length > 0 || highlights.length > 0;

  return (
    <div className="bg-surface border border-line-subtle rounded-sm p-3.5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-2 text-xs font-semibold text-ink-primary hover:text-accent transition-colors cursor-pointer"
        >
          <StickyNote className="w-4 h-4 text-accent" />
          <span>
            {hasSavedContent ? "Meu Macete & Grifos (Caderno)" : "Criar anotação / macete (N)"}
          </span>
          {highlights.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-xs bg-warning/20 text-[10px] font-mono-lab">
              {highlights.length} grifo{highlights.length > 1 ? "s" : ""}
            </span>
          )}
        </button>

        <div className="flex items-center gap-1.5">
          {(["yellow", "green", "blue", "pink"] as HighlightColor[]).map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setActiveColor(color)}
              aria-label={`Cor de grifo ${color}`}
              className={`w-3.5 h-3.5 rounded-full border cursor-pointer transition-transform ${
                color === "yellow"
                  ? "bg-amber-300 border-amber-500"
                  : color === "green"
                  ? "bg-emerald-300 border-emerald-500"
                  : color === "blue"
                  ? "bg-sky-300 border-sky-500"
                  : "bg-rose-300 border-rose-500"
              } ${activeColor === color ? "scale-125 ring-1 ring-ink-primary" : "opacity-70"}`}
            />
          ))}
          <button
            type="button"
            onClick={handleHighlightSelection}
            title="Selecione texto do enunciado e clique aqui (ou pressione M)"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xs border border-line-subtle bg-elevated hover:bg-canvas text-[11px] font-medium text-ink-primary transition-colors cursor-pointer"
          >
            <Highlighter className="w-3.5 h-3.5 text-warning" />
            Grifar seleção (M)
          </button>
        </div>
      </div>

      {(isOpen || highlights.length > 0) && (
        <div className="flex flex-col gap-2.5 pt-2 border-t border-line-subtle/70">
          {highlights.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {highlights.map((hl) => (
                <span
                  key={hl.id}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-xs border text-[11px] ${COLOR_STYLES[hl.color]}`}
                >
                  <span className="max-w-[320px] truncate">“{hl.text}”</span>
                  <button
                    type="button"
                    onClick={() => removeHighlight(hl.id)}
                    aria-label="Remover grifo"
                    className="hover:text-destructive cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {isOpen && (
            <div className="flex flex-col gap-2">
              <textarea
                value={noteText}
                onChange={(e) => setDraftNote(e.target.value)}
                rows={3}
                placeholder="Anote aqui o raciocínio-chave, regra de ouro ou pegadinha desta questão..."
                className="w-full p-2.5 text-xs bg-canvas border border-line-subtle rounded-xs text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent resize-y"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ highlights, note_text: noteText })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xs bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saveMutation.isPending ? "Salvando..." : "Salvar no Caderno"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function QuestionNotePanel({ questionId }: { questionId: number }) {
  return <QuestionNotePanelInner key={questionId} questionId={questionId} />;
}

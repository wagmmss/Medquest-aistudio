"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, BookOpen, Highlighter, StickyNote, ArrowUpRight } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { QuestionUserNote } from "@/types/api";

const AREAS = [
  "",
  "Clínica Médica",
  "Cirurgia Geral",
  "Ginecologia e Obstetrícia",
  "Pediatria",
  "Medicina Preventiva",
];

export function CadernoClient() {
  const queryClient = useQueryClient();
  const [areaFilter, setAreaFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["smart-notebook", areaFilter, searchTerm],
    queryFn: () => api.notes.list({ area: areaFilter || undefined, q: searchTerm || undefined }),
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (qid: number) => api.notes.remove(qid),
    onSuccess: () => {
      toast.success("Anotação removida do Caderno.");
      void queryClient.invalidateQueries({ queryKey: ["smart-notebook"] });
    },
    onError: () => {
      toast.error("Não foi possível remover a anotação.");
    },
  });

  const notes: QuestionUserNote[] = data?.notes ?? [];

  return (
    <div className="flex flex-col gap-5 w-full max-w-5xl mx-auto">
      <header className="mq-page-hero p-5 sm:p-6 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="inline-block text-xs font-semibold text-accent">
            Retenção Ativa &amp; Macetes
          </span>
          <h1 className="text-2xl font-bold text-ink-primary tracking-tight flex items-center gap-2 mt-0.5">
            <StickyNote className="w-6 h-6 text-accent" />
            Caderno Inteligente
          </h1>
          <p className="text-sm text-ink-secondary mt-1">
            Todos os grifos de enunciado e macetes clínicos anotados durante suas sessões, organizados por área e tema.
          </p>
        </div>
        <Link
          href="/estudar"
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors shrink-0 shadow-2xs"
        >
          <BookOpen className="w-3.5 h-3.5" />
          Estudar Questões
        </Link>
      </header>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-ink-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Buscar em macetes, grifos ou subtemas"
            placeholder="Buscar em macetes, grifos ou subtemas..."
            className="w-full pl-10 pr-3 py-2.5 text-xs bg-surface border border-line-subtle rounded-xl text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent shadow-2xs"
          />
        </div>
        <select
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          aria-label="Filtrar por grande área"
          className="px-3.5 py-2.5 text-xs bg-surface border border-line-subtle rounded-xl text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent shadow-2xs"
        >
          <option value="">Todas as Grandes Áreas</option>
          {AREAS.filter(Boolean).map((area) => (
            <option key={area} value={area}>
              {area}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-xs text-ink-secondary">
          Carregando suas anotações...
        </div>
      ) : isError ? (
        <div className="p-4 rounded-xs border border-destructive/30 bg-destructive/5 text-xs text-destructive">
          Erro ao carregar o Caderno Inteligente. Verifique sua conexão e tente novamente.
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-surface border border-line-subtle rounded-sm gap-2">
          <StickyNote className="w-8 h-8 text-ink-muted opacity-60" />
          <h2 className="text-sm font-semibold text-ink-primary">Nenhuma anotação encontrada</h2>
          <p className="text-xs text-ink-secondary max-w-md">
            Durante a resolução de questões no módulo Estudar, selecione trechos para grifar ou salve um macete clínico na própria questão.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {notes.map((note) => (
            <article
              key={note.question_id}
              className="bg-surface border border-line-subtle rounded-sm p-4 flex flex-col gap-3 shadow-2xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="px-2 py-0.5 rounded-xs bg-elevated border border-line-subtle font-mono-lab font-semibold text-ink-primary">
                    Q#{note.question_id}
                  </span>
                  {note.institution_code && (
                    <span className="px-2 py-0.5 rounded-xs bg-accent/10 text-accent font-medium">
                      {note.institution_code} {note.year ? `• ${note.year}` : ""}
                    </span>
                  )}
                  {note.area && (
                    <span className="px-2 py-0.5 rounded-xs bg-elevated text-ink-secondary">
                      {note.area}
                    </span>
                  )}
                  {note.subtema && (
                    <span className="px-2 py-0.5 rounded-xs bg-elevated/80 text-ink-muted">
                      {note.subtema}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    href={`/estudar?q=${note.question_id}`}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                  >
                    Abrir tema <ArrowUpRight className="w-3 h-3" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(note.question_id)}
                    className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xs text-ink-muted hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                    title="Excluir anotação"
                    aria-label={`Excluir anotação da questão ${note.question_id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {note.note_text && (
                <div className="bg-elevated/60 border-l-2 border-accent px-3 py-2 rounded-r-xs text-xs text-ink-primary whitespace-pre-wrap leading-relaxed">
                  {note.note_text}
                </div>
              )}

              {note.highlights && note.highlights.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-mono-lab uppercase tracking-wider text-ink-muted flex items-center gap-1">
                    <Highlighter className="w-3 h-3" /> Trechos grifados ({note.highlights.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {note.highlights.map((hl) => (
                      <span
                        key={hl.id}
                        className="px-2 py-0.5 rounded-xs text-[11px] bg-warning/15 text-ink-primary border border-warning/30"
                      >
                        “{hl.text}”
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {note.stem_preview && (
                <p className="text-[11px] text-ink-muted line-clamp-2 border-t border-line-subtle/60 pt-2">
                  {note.stem_preview}...
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

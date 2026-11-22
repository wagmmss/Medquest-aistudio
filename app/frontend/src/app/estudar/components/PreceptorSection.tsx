"use client";

import React, { useState, useRef, useEffect } from "react";
import { Stethoscope, Sparkles, BookOpen, Send, RotateCcw, Zap, AlertTriangle, Layers, Target, TrendingUp, Clock, FileText } from "lucide-react";
import { FormattedContent } from "@/components/FormattedContent";

export interface GroundingSource {
  source_file: string;
  source_type?: string;
  topic?: string;
  subtopic?: string;
  title?: string;
}

export interface WeakTopicItem {
  topic: string;
  area: string;
  attempts: number;
  correct: number;
  wrong: number;
  accuracy_pct: number;
}

export interface ToolCallData {
  name: string;
  data: {
    status?: string;
    has_data?: boolean;
    total_attempts?: number;
    overall_accuracy_pct?: number;
    srs_due_count?: number;
    weak_topics?: WeakTopicItem[];
    message?: string;
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  source?: string;
  grounding_sources?: GroundingSource[];
  tool_call?: ToolCallData;
}

export interface PreceptorSectionProps {
  messages: ChatMessage[];
  preceptorInput?: string;
  askingPreceptor: boolean;
  onChangeInput?: (value: string) => void;
  onSendMessage: (overrideText?: string) => void;
  onClearChat: () => void;
}

const QUICK_ACTIONS = [
  { label: "/foco", icon: Target, prompt: "/foco", desc: "Diagnóstico adaptativo e temas fracos" },
  { label: "/conduta", icon: Zap, prompt: "/conduta", desc: "Algoritmo de conduta, drogas e doses" },
  { label: "/pegadinhas", icon: AlertTriangle, prompt: "/pegadinhas", desc: "Armadilhas clássicas de bancas" },
  { label: "/round", icon: Stethoscope, prompt: "/round", desc: "Perguntas afiadas beira-leito" },
  { label: "/caso", icon: Layers, prompt: "/caso", desc: "Desafio clínico correlato" },
];

export const PreceptorSection: React.FC<PreceptorSectionProps> = React.memo(({
  messages,
  preceptorInput = "",
  askingPreceptor,
  onChangeInput,
  onSendMessage,
  onClearChat,
}) => {
  const [localInput, setLocalInput] = useState(preceptorInput);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalInput(preceptorInput);
  }, [preceptorInput]);

  useEffect(() => {
    if (messages.length === 0) {
      setLocalInput("");
    }
  }, [messages.length]);

  useEffect(() => {
    if (messages.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, askingPreceptor]);

  const handleInputChange = (val: string) => {
    setLocalInput(val);
    onChangeInput?.(val);
  };

  const triggerSend = (overrideText?: string) => {
    const text = (overrideText ?? localInput).trim();
    if (!text || askingPreceptor) return;
    if (!overrideText) {
      setLocalInput("");
      onChangeInput?.("");
    }
    onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      triggerSend();
    }
  };

  return (
    <div className="mt-6 bg-elevated/30 border border-line-subtle rounded-lg p-5 transition-all">
      <div className="flex items-center justify-between mb-3.5 pb-2.5 border-b border-line-subtle">
        <h4 className="text-accent font-mono-lab font-bold flex items-center gap-2 uppercase tracking-wider text-xs">
          <Stethoscope size={16} /> Discussão Clínica & Preceptor IA
        </h4>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setLocalInput("");
              onClearChat();
            }}
            disabled={askingPreceptor}
            className="text-xs text-ink-muted hover:text-ink-primary flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            title="Reiniciar discussão clínica"
          >
            <RotateCcw size={13} />
            <span>Reiniciar Chat</span>
          </button>
        )}
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-ink-secondary">
            Tire dúvidas conceituais, discuta diagnósticos diferenciais ou use comandos socráticos rápidos:
          </p>

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => triggerSend(action.prompt)}
                  disabled={askingPreceptor}
                  className="font-mono-lab text-xs font-semibold bg-surface hover:bg-accent/10 text-ink-primary hover:text-accent border border-line-subtle hover:border-accent/30 px-2.5 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  title={action.desc}
                >
                  <Icon size={13} className="text-accent" />
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>

          <textarea
            aria-label="Pergunta ou hipótese clínica para o Preceptor IA"
            className="w-full bg-canvas border border-line-subtle rounded-md p-3 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-none min-h-[85px] mt-1"
            placeholder="Qual conduta você tem dúvida? Ex: 'Por que a alternativa D está errada?' ou aperte Enter..."
            value={localInput}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => triggerSend()}
              disabled={askingPreceptor || !localInput.trim()}
              className="bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-semibold py-2 px-4 min-h-[38px] rounded-md shadow-2xs transition-colors flex items-center gap-2 text-xs cursor-pointer disabled:cursor-not-allowed"
            >
              {askingPreceptor ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              {askingPreceptor ? "Consultando Preceptor..." : "Enviar Pergunta"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`rounded-lg p-4 max-w-[94%] md:max-w-[88%] text-sm ${
                    msg.role === "user"
                      ? "bg-accent text-white shadow-2xs"
                      : "bg-surface border border-line-subtle text-ink-primary shadow-2xs"
                  }`}
                >
                  {msg.role === "assistant" && msg.grounding_sources && msg.grounding_sources.length > 0 && (
                    <div className="mb-3 pb-2.5 border-b border-line-subtle">
                      <div className="text-[11px] font-mono-lab font-semibold text-normal flex items-center gap-1.5 mb-1.5">
                        <BookOpen size={13} />
                        <span>Diretrizes e Fichas Consultadas:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.grounding_sources.map((src, i) => (
                          <span
                            key={i}
                            className="text-[11px] bg-normal-bg text-normal border border-normal/25 px-2 py-0.5 rounded-xs flex items-center gap-1"
                            title={src.title || src.source_file}
                          >
                            <FileText size={11} className="shrink-0" />
                            <span className="font-medium">{src.source_file.replace(/\.(pdf|txt)$/i, "")}</span>
                            {src.topic && <span className="opacity-70 text-[10px]">({src.topic})</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {msg.role === "assistant" && msg.tool_call?.name === "get_student_weak_topics" && msg.tool_call.data && (
                    <div className="mb-3.5 p-3.5 bg-elevated/40 border border-line-subtle rounded-md">
                      <div className="flex items-center justify-between mb-2 pb-2 border-b border-line-subtle">
                        <span className="text-xs font-bold text-accent flex items-center gap-1.5">
                          <Target size={14} /> Diagnóstico Adaptativo do Aluno
                        </span>
                        {msg.tool_call.data.has_data && (
                          <span className="font-mono-lab tabular-nums text-[11px] text-ink-muted font-medium">
                            {msg.tool_call.data.total_attempts} questões resolvidas
                          </span>
                        )}
                      </div>

                      {msg.tool_call.data.has_data ? (
                        <div className="space-y-2.5">
                          <div className="flex flex-wrap items-center gap-4 text-xs">
                            <div className="flex items-center gap-1.5">
                              <TrendingUp size={13} className="text-accent" />
                              <span>
                                Acurácia Global: <strong className="font-mono-lab tabular-nums">{msg.tool_call.data.overall_accuracy_pct}%</strong>
                              </span>
                            </div>
                            {(msg.tool_call.data.srs_due_count ?? 0) > 0 && (
                              <div className="flex items-center gap-1.5 text-warning font-semibold font-mono-lab tabular-nums">
                                <Clock size={13} />
                                <span>{msg.tool_call.data.srs_due_count} revisões FSRS pendentes</span>
                              </div>
                            )}
                          </div>

                          {msg.tool_call.data.weak_topics && msg.tool_call.data.weak_topics.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                              <span className="font-mono-lab text-[10px] font-semibold text-ink-muted uppercase tracking-wider block">
                                Subtemas com Maior Risco de Erro:
                              </span>
                              {msg.tool_call.data.weak_topics.map((wt, idx) => (
                                <div key={idx} className="flex items-center justify-between text-xs bg-surface p-1.5 rounded-xs border border-line-subtle">
                                  <span className="font-medium truncate max-w-[60%]">
                                    {wt.topic} <span className="text-ink-muted text-[10px]">({wt.area})</span>
                                  </span>
                                  <span
                                    className={`font-mono-lab tabular-nums font-bold px-1.5 py-0.5 rounded-xs text-[11px] ${
                                      wt.accuracy_pct < 50
                                        ? "bg-critical-bg text-critical"
                                        : "bg-warning/15 text-warning"
                                    }`}
                                  >
                                    {wt.accuracy_pct}% ({wt.wrong} erros)
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-ink-secondary">
                          Nenhum dado registrado ainda. Resolva questões no quiz para calibrar seu diagnóstico adaptativo!
                        </p>
                      )}
                    </div>
                  )}

                  {msg.role === "user" ? (
                    (() => {
                      const trimmed = msg.content.trim();
                      const action = QUICK_ACTIONS.find((a) => a.prompt === trimmed);
                      if (action) {
                        const Icon = action.icon;
                        return (
                          <div className="flex items-center gap-2 font-medium">
                            <span className="p-1 rounded-xs bg-white/20">
                              <Icon size={14} className="text-white" />
                            </span>
                            <span>{action.label}</span>
                            <span className="opacity-80 text-xs font-normal">({action.desc})</span>
                          </div>
                        );
                      }
                      return <div className="font-medium whitespace-pre-wrap">{msg.content}</div>;
                    })()
                  ) : (
                    <div className="leading-relaxed">
                      <FormattedContent content={msg.content} />
                    </div>
                  )}

                  {msg.role === "assistant" && msg.model && (
                    <div className="mt-2.5 pt-2 border-t border-line-subtle text-[10px] text-ink-muted font-mono-lab flex items-center justify-between">
                      <span>Preceptor IA ({msg.model})</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {askingPreceptor && (
              <div className="flex items-start">
                <div className="bg-surface border border-line-subtle rounded-lg p-3.5 flex items-center gap-3 text-ink-secondary text-xs">
                  <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <span>Preceptor analisando condutas e diretrizes...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-line-subtle">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => triggerSend(action.prompt)}
                  disabled={askingPreceptor}
                  className="font-mono-lab text-[11px] font-medium bg-surface hover:bg-accent/10 text-ink-primary hover:text-accent border border-line-subtle hover:border-accent/30 px-2 py-1 rounded-xs flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                  title={action.desc}
                >
                  <Icon size={12} className="text-accent" />
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex gap-2">
            <textarea
              aria-label="Réplica ou dúvida adicional para o Preceptor IA"
              className="flex-1 bg-canvas border border-line-subtle rounded-md p-2.5 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-none min-h-[44px] max-h-[120px]"
              placeholder={(() => {
                const lastMsg = messages[messages.length - 1];
                if (lastMsg && lastMsg.role === "assistant") {
                  const lower = lastMsg.content.toLowerCase();
                  if (lower.includes("qual é a sua conduta") || lower.includes("letra da alternativa") || lower.includes("qual a sua resposta")) {
                    return "Digite a letra da sua resposta para o desafio do preceptor (ex: Letra B)...";
                  }
                  if (lower.includes("pergunta 1") || lower.includes("como você responde a cada")) {
                    return "Responda às 3 perguntas da visita beira-leito...";
                  }
                }
                return "Digite sua réplica ou dúvida adicional...";
              })()}
              rows={1}
              value={localInput}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              onClick={() => triggerSend()}
              disabled={askingPreceptor || !localInput.trim()}
              aria-label="Enviar mensagem ao Preceptor IA"
              className="bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-semibold px-3.5 min-w-[44px] min-h-[44px] rounded-md shadow-2xs transition-colors flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
              title="Enviar réplica"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

PreceptorSection.displayName = "PreceptorSection";

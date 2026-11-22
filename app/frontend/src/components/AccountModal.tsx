"use client";

import { useState } from "react";
import { useAppClerk, useAppUser } from "@/lib/auth-client";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { localDb, getLocalOwnerId } from "@/lib/db";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { clearLearningSessions } from "@/lib/sessionState";
import { X, Trash2, LogOut, AlertTriangle, User, ShieldAlert } from "lucide-react";

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AccountModal({ isOpen, onClose }: AccountModalProps) {
  const { user, isLoaded } = useAppUser();
  const { signOut, clerkEnabled } = useAppClerk();
  const router = useRouter();

  const [step, setStep] = useState<"profile" | "confirm_reset">("profile");
  const [confirmText, setConfirmText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResetProgress = async () => {
    if (confirmText.toUpperCase() !== "RESETAR") return;

    setIsLoading(true);
    setError(null);
    try {
      const res = await api.stats.resetProgress();
      if (res.success) {
        clearLearningSessions();
        localStorage.removeItem("medquest_simulado_config");
        localStorage.removeItem("mq_last_confetti");
        localStorage.removeItem("medquest_last_offline_download");
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("medquest_planner_topics_") || (key.startsWith("medquest_") && key !== "medquest_local_owner" && key !== "theme")) {
            localStorage.removeItem(key);
          }
        }
        if (localDb) {
          try {
            const uid = getLocalOwnerId();
            await Promise.all([
              localDb.questions.where("_owner_id").equals(uid).delete(),
              localDb.simuladoPackages.where("owner_id").equals(uid).delete(),
              localDb.syncQueue.where("owner_id").equals(uid).delete(),
            ]);
          } catch (dexieErr) {
            console.warn("Erro ao limpar dados locais no reset:", dexieErr);
          }
        }
        resetStateAndClose();
        router.push("/");
        router.refresh();
      } else {
        setError("Não foi possível resetar o progresso. Tente novamente.");
        setIsLoading(false);
      }
    } catch (err) {
      console.error(err);
      setError("Ocorreu um erro ao resetar o progresso.");
      setIsLoading(false);
    }
  };

  const resetStateAndClose = () => {
    setStep("profile");
    setConfirmText("");
    setError(null);
    setIsLoading(false);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isLoading && resetStateAndClose()}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 12 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.12 }}
            className="bg-surface border border-line-subtle rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto z-10 flex flex-col relative"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-modal-title"
          >
            <div className="flex justify-between items-center px-5 py-4 border-b border-line-subtle sticky top-0 bg-surface/95 backdrop-blur z-20">
              <h2 id="account-modal-title" className="text-base font-bold text-ink-primary tracking-tight">
                {step === "profile" ? "Minha Conta" : "Resetar Progresso"}
              </h2>
              <button
                onClick={() => !isLoading && resetStateAndClose()}
                disabled={isLoading}
                className="text-ink-muted hover:bg-elevated hover:text-ink-primary rounded-md p-1.5 transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 flex-1 flex flex-col gap-5">
              <AnimatePresence mode="wait">
                {step === "profile" ? (
                  <motion.div
                    key="profile"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.18 }}
                    className="flex flex-col gap-5"
                  >
                    {/* Perfil Header */}
                    <div className="flex items-center gap-4 bg-elevated/40 p-4 rounded-lg border border-line-subtle">
                      <div className="relative w-14 h-14 rounded-md bg-elevated overflow-hidden shrink-0 border border-line-subtle">
                        {isLoaded && user?.imageUrl ? (
                          <Image src={user.imageUrl} alt="Avatar" fill sizes="56px" className="object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-accent/10 text-accent">
                            <User size={26} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-ink-primary truncate">
                          {isLoaded ? (user?.fullName || "Usuário MedQuest") : "Carregando..."}
                        </h3>
                        <p className="text-xs text-ink-secondary truncate">
                          {isLoaded ? (user?.primaryEmailAddress?.emailAddress || "") : ""}
                        </p>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 mt-1.5 rounded-xs font-mono-lab text-[10px] font-semibold uppercase tracking-wider bg-accent/10 text-accent border border-accent/20">
                          Preparação USP
                        </span>
                      </div>
                    </div>

                    {/* Ações de Conta */}
                    <div className="flex flex-col gap-2.5">
                      <button
                        onClick={() => setStep("confirm_reset")}
                        className="flex items-center gap-3 px-4 py-3 rounded-md bg-destructive/5 text-destructive hover:bg-destructive/10 border border-destructive/20 hover:border-destructive/30 transition-colors text-left w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                      >
                        <Trash2 className="text-destructive shrink-0" size={18} />
                        <div className="flex-1">
                          <p className="font-semibold text-sm">Resetar Todo o Progresso</p>
                          <p className="text-xs opacity-80 mt-0.5">Apagar histórico de questões, planos e revisões</p>
                        </div>
                      </button>

                      {clerkEnabled && (
                        <button
                          onClick={() => {
                            localStorage.removeItem("medquest_last_user_id");
                            void signOut({ redirectUrl: "/" });
                          }}
                          className="flex items-center gap-3 px-4 py-3 rounded-md bg-elevated/30 text-ink-primary hover:bg-elevated border border-line-subtle transition-colors text-left w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <LogOut className="text-ink-muted shrink-0" size={18} />
                          <div className="flex-1">
                            <p className="font-semibold text-sm">Sair da Conta</p>
                            <p className="text-xs text-ink-secondary mt-0.5">Fazer logout da sessão atual</p>
                          </div>
                        </button>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="confirm"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.18 }}
                    className="flex flex-col gap-4"
                  >
                    <div className="bg-destructive/10 border border-destructive/25 rounded-md p-4 flex gap-3">
                      <ShieldAlert className="text-destructive shrink-0 mt-0.5" size={20} />
                      <div className="flex flex-col gap-1">
                        <p className="font-mono-lab font-bold text-destructive text-xs uppercase tracking-wider">Atenção! Ação irreversível.</p>
                        <p className="text-xs text-ink-secondary leading-relaxed">
                          Ao prosseguir, todo o seu histórico de simulados, estatísticas de acertos, favoritos
                          e cronograma de estudos semanal (Planner) serão permanentemente excluídos.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label htmlFor="confirm-reset-input" className="text-xs font-semibold text-ink-primary">
                        Para confirmar, digite <span className="font-mono-lab text-destructive">RESETAR</span> no campo abaixo:
                      </label>
                      <input
                        id="confirm-reset-input"
                        type="text"
                        autoFocus
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder="Digite RESETAR"
                        disabled={isLoading}
                        className="w-full px-3.5 py-2.5 rounded-md border border-line-subtle bg-canvas text-ink-primary focus:outline-none focus:border-destructive focus:ring-1 focus:ring-destructive transition-all font-mono-lab tracking-widest text-center text-sm"
                      />
                    </div>

                    {error && (
                      <p role="alert" className="text-destructive text-xs font-semibold flex items-center gap-1.5 justify-center">
                        <AlertTriangle size={15} />
                        {error}
                      </p>
                    )}

                    <div className="flex gap-3 mt-2">
                      <button
                        onClick={() => {
                          setStep("profile");
                          setConfirmText("");
                          setError(null);
                        }}
                        disabled={isLoading}
                        className="flex-1 py-2.5 px-4 rounded-md border border-line-subtle text-ink-primary hover:bg-elevated transition-colors text-center font-semibold text-xs cursor-pointer disabled:opacity-50"
                      >
                        Voltar
                      </button>
                      <button
                        onClick={handleResetProgress}
                        disabled={confirmText.toUpperCase() !== "RESETAR" || isLoading}
                        className="flex-1 py-2.5 px-4 rounded-md bg-destructive text-white hover:bg-destructive/90 disabled:bg-elevated disabled:text-ink-muted disabled:cursor-not-allowed transition-colors text-center font-semibold text-xs cursor-pointer flex items-center justify-center gap-2"
                      >
                        {isLoading ? "Resetando..." : "Confirmar Reset"}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

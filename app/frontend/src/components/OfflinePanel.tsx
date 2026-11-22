"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  CloudOff,
  Download,
  RefreshCw,
  Database,
  AlertCircle,
  Trash2,
  CheckCircle2,
  Play,
  BookOpen,
  Smartphone,
  Sun,
  ShieldCheck,
  Zap,
} from "lucide-react";

import {
  localDb,
  getLocalOwnerId,
  SyncItem,
  SimuladoPackage,
  isPackageValid,
  setForcedOffline,
} from "@/lib/db";
import { syncManager } from "@/lib/sync";
import {
  downloadSimuladoPackage,
  getReadySimuladoPackage,
  listSimuladoPackages,
  deleteSimuladoPackage,
} from "@/lib/simuladoPackage";
import { useOfflineStatus } from "@/lib/useOfflineStatus";
import { useWakeLock } from "@/hooks/useWakeLock";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import toast from "react-hot-toast";

export function OfflinePanel({ onClose }: { onClose?: () => void } = {}) {
  const { isOffline, forcedOffline } = useOfflineStatus();
  const [storageInfo, setStorageInfo] = useState<{ usedMb: number; quotaMb: number; persisted: boolean } | null>(null);
  const { isSupported: isWakeLockSupported, isActive: isWakeLockActive, toggleWakeLock } = useWakeLock();
  const { isInstallable, installApp } = usePwaInstall();

  const [stats, setStats] = useState({ questions: 0, queue: 0 });
  const [packages, setPackages] = useState<SimuladoPackage[]>([]);
  const [activePackage, setActivePackage] = useState<SimuladoPackage | null>(null);
  const [failedItems, setFailedItems] = useState<SyncItem[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState<string>("");
  const [questionCount, setQuestionCount] = useState<number>(50);
  const [lastDownloadDate, setLastDownloadDate] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [confirmDeletePkgId, setConfirmDeletePkgId] = useState<string | null>(null);
  const [confirmClearOffline, setConfirmClearOffline] = useState(false);
  const downloadResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (downloadResetTimerRef.current) clearTimeout(downloadResetTimerRef.current);
  }, []);

  const updateStats = useCallback(async () => {
    if (!localDb) return;
    try {
      const uid = getLocalOwnerId();
      const questions = await localDb.questions.where("_owner_id").equals(uid).count();
      const queue = await localDb.syncQueue.where("owner_id").equals(uid).filter((i) => i.status === "pending").count();
      const failed = await syncManager.getFailedItems();
      const pkgList = await listSimuladoPackages(uid);
      const readyPkg = await getReadySimuladoPackage(uid);

      setStats({ questions, queue });
      setFailedItems(failed);
      setPackages(pkgList);
      setActivePackage(readyPkg);

      const savedDate = localStorage.getItem("medquest_last_offline_download");
      if (savedDate) {
        setLastDownloadDate(savedDate);
      }

      if (typeof navigator !== "undefined" && navigator.storage) {
        try {
          const persisted = (await navigator.storage.persisted?.()) || false;
          const estimate = await navigator.storage.estimate?.();
          if (estimate && estimate.quota && estimate.usage !== undefined) {
            setStorageInfo({
              usedMb: Math.round(estimate.usage / (1024 * 1024)),
              quotaMb: Math.round(estimate.quota / (1024 * 1024)),
              persisted,
            });
          }
        } catch {
          // ignore storage estimate error
        }
      }
    } catch (error) {
      console.error("Failed to read local stats", error);
    }
  }, []);

  useEffect(() => {
    const initialStatsTimer = setTimeout(() => void updateStats(), 0);

    const handleQueueUpdate = () => void updateStats();
    const handlePackageUpdate = () => void updateStats();
    window.addEventListener("sync-queue-updated", handleQueueUpdate);
    window.addEventListener("simulado-package-updated", handlePackageUpdate);

    return () => {
      window.removeEventListener("sync-queue-updated", handleQueueUpdate);
      window.removeEventListener("simulado-package-updated", handlePackageUpdate);
      clearTimeout(initialStatsTimer);
    };
  }, [updateStats]);

  const handleDownloadPackage = async () => {
    if (isDownloading || isOffline) return;
    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadStatus("Iniciando download do pacote...");

    try {
      const questionsPerArea = Math.max(5, Math.round(questionCount / 5));
      await downloadSimuladoPackage(
        {
          name: `Simulado USP/Geral (${questionCount} Qs)`,
          questions_per_area: questionsPerArea,
          duration_minutes: Math.round((questionCount / 20) * 60),
          force_4_options: false,
        },
        (p) => {
          setDownloadProgress(p.progress);
          setDownloadStatus(p.message);
        }
      );

      const nowStr = new Date().toISOString();
      localStorage.setItem("medquest_last_offline_download", nowStr);
      setLastDownloadDate(nowStr);

      await updateStats();
      toast.success("Pacote de Simulado Offline pronto!");
    } catch (e) {
      console.error("Erro ao baixar pacote offline:", e);
      const message = e instanceof Error ? e.message : "Erro desconhecido";
      toast.error(`Não foi possível concluir o pacote: ${message}`);
    } finally {
      downloadResetTimerRef.current = setTimeout(() => {
        setIsDownloading(false);
        setDownloadProgress(0);
        setDownloadStatus("");
      }, 1200);
    }
  };

  const confirmAndDeletePackage = async (packageId: string) => {
    try {
      await deleteSimuladoPackage(packageId);
      setConfirmDeletePkgId(null);
      await updateStats();
      toast.success("Pacote offline removido.");
    } catch {
      toast.error("Erro ao remover pacote.");
    }
  };

  const confirmAndClearOfflineData = async () => {
    if (!localDb) return;
    try {
      const uid = getLocalOwnerId();
      await Promise.all([
        localDb.questions.where("_owner_id").equals(uid).delete(),
        localDb.simuladoPackages.where("owner_id").equals(uid).delete(),
      ]);

      localStorage.removeItem("medquest_last_offline_download");
      setLastDownloadDate(null);
      setConfirmClearOffline(false);
      await updateStats();
      toast.success("Dados offline limpos deste dispositivo.");
    } catch (err) {
      console.error("Erro ao limpar dados offline:", err);
      toast.error("Erro ao limpar dados locais.");
    }
  };

  const handleManualSync = async () => {
    if (isSyncing || isOffline) return;
    setIsSyncing(true);
    try {
      await syncManager.sync(true);
      await updateStats();
      toast.success("Sincronização concluída com sucesso!");
    } catch {
      toast.error("Erro ao sincronizar. Tente novamente.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRetryItem = async (id: string) => {
    await syncManager.retryItem(id);
    await updateStats();
  };

  const handleDiscardItem = async (id: string) => {
    await syncManager.discardItem(id);
    await updateStats();
  };

  const handleToggleForcedOffline = () => {
    const next = !forcedOffline;
    setForcedOffline(next);
    if (next) {
      toast.success("Modo Plantão forçado ativado (0ms latência local).");
    } else {
      toast("Modo Plantão forçado desativado.");
    }
  };

  const handleInstallClick = async () => {
    const installed = await installApp();
    if (installed) {
      toast.success("MedQuest instalado com sucesso!");
    }
  };

  const formattedLastDate = lastDownloadDate
    ? new Date(lastDownloadDate).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const pkgValidity = activePackage ? isPackageValid(activePackage) : { valid: false };

  return (
    <div className="bg-surface border border-line-subtle rounded-lg p-5 flex flex-col gap-5">
      <div>
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-line-subtle pr-8">
          <h3 id="offline-modal-title" className="text-lg font-bold text-ink-primary flex items-center gap-2 tracking-tight">
            {isOffline ? (
              <CloudOff className="text-warning" size={20} aria-hidden="true" />
            ) : (
              <Database className="text-accent" size={20} aria-hidden="true" />
            )}
            Modo Plantão (Offline)
          </h3>
          <span
            className={`px-2 py-0.5 rounded-xs font-mono-lab text-[10px] font-bold uppercase tracking-wider border ${
              isOffline
                ? "bg-warning/15 text-warning border-warning/30"
                : "bg-success/15 text-success border-success/30"
            }`}
          >
            {isOffline ? "Desconectado" : "Online"}
          </span>
        </div>

        <p className="text-xs text-ink-secondary mb-4 leading-relaxed">
          Baixe pacotes completos de simulado para realizar sua prova sem internet. Suas respostas serão gravadas no dispositivo e sincronizadas de forma segura ao reconectar.
        </p>

        {formattedLastDate && (
          <p className="text-xs text-ink-secondary mb-4 flex items-center gap-1.5 font-medium">
            <CheckCircle2 size={14} className="text-success shrink-0" />
            Última atualização local: <strong className="font-mono-lab text-ink-primary">{formattedLastDate}</strong>
          </p>
        )}

        {/* Controles de Plantão & Android */}
        <div className="mb-5 p-4 rounded-lg bg-elevated/40 border border-line-subtle flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-mono-lab text-[11px] font-semibold uppercase tracking-wider text-ink-muted flex items-center gap-1.5">
              <Zap size={13} className="text-warning" />
              Otimizações para Plantão & Android
            </span>
            {isOffline && (
              <span className="font-mono-lab text-[10px] font-bold px-2 py-0.5 rounded-xs bg-warning/15 text-warning">
                {forcedOffline ? "Plantão Forçado" : "Sem Conexão"}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Switch Forçar Modo Plantão */}
            <div className="flex items-center justify-between p-3 rounded-md bg-surface border border-line-subtle">
              <div className="flex flex-col pr-2">
                <span className="text-xs font-semibold text-ink-primary flex items-center gap-1.5">
                  <CloudOff size={14} className={forcedOffline ? "text-warning" : "text-ink-muted"} />
                  Forçar Modo Plantão
                </span>
                <span className="text-[11px] text-ink-secondary">
                  Ignora Wi-Fi instável e responde localmente
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={forcedOffline}
                onClick={handleToggleForcedOffline}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  forcedOffline ? "bg-warning" : "bg-elevated"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    forcedOffline ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Switch Tela Acesa (Wake Lock) */}
            <div className="flex items-center justify-between p-3 rounded-md bg-surface border border-line-subtle">
              <div className="flex flex-col pr-2">
                <span className="text-xs font-semibold text-ink-primary flex items-center gap-1.5">
                  <Sun size={14} className={isWakeLockActive ? "text-warning" : "text-ink-muted"} />
                  Manter Tela Acesa
                </span>
                <span className="text-[11px] text-ink-secondary">
                  {isWakeLockSupported
                    ? "Impede bloqueio de tela durante estudo"
                    : "Não suportado neste navegador"}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                disabled={!isWakeLockSupported}
                aria-checked={isWakeLockActive}
                onClick={() => void toggleWakeLock()}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
                  isWakeLockActive ? "bg-warning" : "bg-elevated"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isWakeLockActive ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {isInstallable && (
            <div className="flex items-center justify-between p-3 rounded-md bg-accent/10 border border-accent/20 text-xs">
              <div className="flex items-center gap-2.5">
                <Smartphone className="text-accent" size={18} />
                <div>
                  <p className="font-semibold text-ink-primary">Instalar MedQuest no Android</p>
                  <p className="text-ink-secondary text-[11px]">
                    Acesse tela cheia e atalhos rápidos diretamente da tela inicial
                  </p>
                </div>
              </div>
              <button
                onClick={handleInstallClick}
                className="px-3 py-1.5 rounded-md bg-accent text-white font-semibold text-xs hover:bg-accent/90 transition-colors shrink-0 cursor-pointer"
              >
                Instalar
              </button>
            </div>
          )}

          {storageInfo && (
            <div className="flex items-center justify-between text-[11px] text-ink-secondary pt-1 border-t border-line-subtle">
              <span className="flex items-center gap-1">
                <ShieldCheck size={13} className={storageInfo.persisted ? "text-success" : "text-ink-muted"} />
                {storageInfo.persisted ? "Armazenamento protegido contra limpeza" : "Armazenamento padrão"}
              </span>
              <span className="font-mono-lab tabular-nums">
                {storageInfo.usedMb} MB / {storageInfo.quotaMb > 1024 ? `${(storageInfo.quotaMb / 1024).toFixed(1)} GB` : `${storageInfo.quotaMb} MB`}
              </span>
            </div>
          )}
        </div>

        {/* Card do Pacote de Simulado Ativo */}
        {activePackage && (
          <div className="mb-5 p-4 rounded-lg bg-elevated/40 border border-line-subtle flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-xs ${pkgValidity.valid ? "bg-success" : "bg-warning"}`} />
                <h4 className="text-sm font-bold text-ink-primary">{activePackage.name}</h4>
              </div>
              <span
                className={`font-mono-lab text-[10px] font-bold uppercase px-2 py-0.5 rounded-xs ${
                  pkgValidity.valid ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                }`}
              >
                {pkgValidity.valid ? "Pronto para uso" : activePackage.status}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-ink-secondary">
              <div>
                <span className="block text-[11px] text-ink-muted">Questões:</span>
                <strong className="font-mono-lab tabular-nums text-ink-primary">
                  {activePackage.details_count} / {activePackage.questions_count}
                </strong>
              </div>
              <div>
                <span className="block text-[11px] text-ink-muted">Imagens em Cache:</span>
                <strong className="font-mono-lab tabular-nums text-ink-primary">{activePackage.images_count}</strong>
              </div>
              <div>
                <span className="block text-[11px] text-ink-muted">Tamanho Est.:</span>
                <strong className="font-mono-lab tabular-nums text-ink-primary">
                  {(activePackage.estimated_size_bytes / 1024).toFixed(0)} KB
                </strong>
              </div>
              <div>
                <span className="block text-[11px] text-ink-muted">Validade:</span>
                <strong className="font-mono-lab tabular-nums text-ink-primary">
                  {new Date(activePackage.expires_at).toLocaleDateString("pt-BR")}
                </strong>
              </div>
            </div>

            {(activePackage.image_failures_count || 0) > 0 && (
              <p className="text-xs text-warning">
                {activePackage.image_failures_count} imagem(ns) indisponível(is) offline; as questões continuam utilizáveis.
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line-subtle">
              {confirmDeletePkgId === activePackage.id ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-ink-secondary">Remover pacote offline?</span>
                  <button
                    type="button"
                    onClick={() => setConfirmDeletePkgId(null)}
                    className="px-2 py-1 rounded-xs border border-line-subtle text-ink-secondary hover:bg-elevated cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmAndDeletePackage(activePackage.id)}
                    className="px-2 py-1 rounded-xs bg-destructive text-white font-semibold hover:bg-destructive/90 cursor-pointer"
                  >
                    Confirmar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeletePkgId(activePackage.id)}
                  className="text-xs text-destructive hover:text-destructive/80 flex items-center gap-1 font-medium px-2 py-1 rounded-xs transition-colors cursor-pointer"
                >
                  <Trash2 size={13} /> Remover Pacote
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-elevated/40 rounded-md p-3 text-center border border-line-subtle">
            <p className="font-mono-lab text-[10px] text-ink-muted uppercase font-semibold tracking-wider">Questões Locais</p>
            <p className="font-mono-lab tabular-nums text-2xl font-bold text-ink-primary mt-0.5">{stats.questions}</p>
          </div>
          <div className="bg-elevated/40 rounded-md p-3 text-center border border-line-subtle relative">
            <p className="font-mono-lab text-[10px] text-ink-muted uppercase font-semibold tracking-wider">Fila de Envio</p>
            <p className="font-mono-lab tabular-nums text-2xl font-bold text-ink-primary mt-0.5">{stats.queue}</p>
            {stats.queue > 0 && !isOffline && (
              <button
                onClick={handleManualSync}
                disabled={isSyncing}
                title="Sincronizar fila agora"
                className="absolute top-2 right-2 text-accent hover:text-accent/80 transition-colors p-1 rounded-xs cursor-pointer"
              >
                <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
              </button>
            )}
          </div>
        </div>

        {/* Seleção do tamanho do pacote quando online */}
        {!isOffline && !isDownloading && (
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 p-3 bg-elevated/30 border border-line-subtle rounded-md text-xs">
            <span className="font-semibold text-ink-secondary">Tamanho do pacote:</span>
            <div className="flex items-center gap-1.5">
              {[25, 50, 100].map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setQuestionCount(count)}
                  className={`px-2.5 py-1 rounded-xs font-mono-lab text-xs font-semibold transition-colors cursor-pointer ${
                    questionCount === count
                      ? "bg-accent text-white"
                      : "bg-surface border border-line-subtle text-ink-secondary hover:text-ink-primary"
                  }`}
                >
                  {count} Qs
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleDownloadPackage}
              disabled={isDownloading || isOffline}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md bg-accent text-white font-semibold text-xs hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {isDownloading ? (
                <>
                  <RefreshCw className="animate-spin" size={16} /> Baixando Pacote...
                </>
              ) : (
                <>
                  <Download size={16} /> Baixar Simulado Offline ({questionCount} Qs)
                </>
              )}
            </button>

            {(stats.questions > 0 || packages.length > 0) && !isDownloading && !confirmClearOffline && (
              <button
                type="button"
                onClick={() => setConfirmClearOffline(true)}
                title="Limpar questões e pacotes salvos neste dispositivo"
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md border border-line-subtle bg-surface hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive text-ink-secondary font-medium text-xs transition-colors cursor-pointer"
              >
                <Trash2 size={15} /> Limpar
              </button>
            )}
          </div>

          {confirmClearOffline && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-md border border-destructive/30 bg-destructive/5 text-xs">
              <span className="text-ink-primary font-medium">
                Remover questões e pacotes salvos neste dispositivo? (A fila pendente não é apagada.)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClearOffline(false)}
                  className="px-2.5 py-1 rounded-xs border border-line-subtle text-ink-secondary hover:bg-elevated cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void confirmAndClearOfflineData()}
                  className="px-2.5 py-1 rounded-xs bg-destructive text-white font-semibold hover:bg-destructive/90 cursor-pointer"
                >
                  Limpar agora
                </button>
              </div>
            </div>
          )}
        </div>

        {isDownloading && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-ink-secondary mb-1.5 font-medium">
              <span>{downloadStatus || "Progresso"}</span>
              <span className="font-mono-lab tabular-nums">{Math.round(downloadProgress)}%</span>
            </div>
            <div className="w-full bg-elevated h-2 rounded-xs overflow-hidden">
              <div
                className="bg-accent h-full transition-all duration-300 ease-out"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          </div>
        )}

        {stats.questions > 0 && (
          <div className="mt-5 pt-4 border-t border-line-subtle flex flex-col gap-2.5">
            <p className="font-mono-lab text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              Acesso Rápido ao Conteúdo Local
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Link
                href="/simulado"
                onClick={() => onClose?.()}
                className="flex items-center justify-center gap-2 p-2.5 rounded-md bg-elevated/40 hover:bg-elevated text-ink-primary border border-line-subtle font-medium text-xs transition-colors"
              >
                <Play size={14} className="text-accent" />
                Simulado Offline
              </Link>
              <Link
                href="/estudar"
                onClick={() => onClose?.()}
                className="flex items-center justify-center gap-2 p-2.5 rounded-md bg-elevated/40 hover:bg-elevated text-ink-primary border border-line-subtle font-medium text-xs transition-colors"
              >
                <BookOpen size={14} className="text-accent" />
                Banco de Questões
              </Link>
            </div>
          </div>
        )}
      </div>

      {failedItems.length > 0 && (
        <div className="border-t border-line-subtle pt-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-destructive font-bold text-xs uppercase font-mono-lab">
            <AlertCircle size={16} />
            <span>Itens com Falha de Sincronização ({failedItems.length})</span>
          </div>
          <p className="text-xs text-ink-secondary">
            As seguintes operações não puderam ser sincronizadas com o servidor. Você pode tentar novamente ou descartá-las.
          </p>
          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
            {failedItems.map((item) => (
              <div key={item.id} className="bg-elevated/40 border border-line-subtle rounded-md p-3 flex items-center justify-between gap-3 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="font-mono-lab font-semibold text-ink-primary truncate">{item.method} {item.endpoint}</p>
                  <p className="text-destructive font-medium truncate">{item.last_error || "Erro de sincronização"}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRetryItem(item.id)}
                    className="flex items-center gap-1 bg-surface hover:bg-elevated border border-line-subtle px-2.5 py-1 rounded-xs text-accent font-semibold transition-colors cursor-pointer"
                  >
                    <RefreshCw size={13} /> Tentar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDiscardItem(item.id)}
                    className="flex items-center gap-1 bg-destructive/10 hover:bg-destructive/20 px-2.5 py-1 rounded-xs text-destructive font-semibold transition-colors cursor-pointer"
                  >
                    <Trash2 size={13} /> Descartar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

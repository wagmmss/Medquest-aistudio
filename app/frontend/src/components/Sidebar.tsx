"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchRouteIntent } from "@/lib/queries/prefetchRouteData";
import clsx from "clsx";
import { useAppUser } from "@/lib/auth-client";
import { AccountModal } from "./AccountModal";
import { OfflineModal } from "./OfflineModal";
import { ThemeToggle } from "./ThemeToggle";
import { useZenMode } from "@/hooks/useZenMode";
import { useOfflineStatus } from "@/lib/useOfflineStatus";
import { NAV_ITEMS } from "@/lib/navigation";
import { ClinicalIcon } from "@/components/ui/ClinicalIcon";
import Image from "next/image";

const SIDEBAR_EVENT = "medquest-sidebar-collapsed-change";

function subscribeSidebarCollapsed(callback: () => void) {
  window.addEventListener(SIDEBAR_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(SIDEBAR_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSidebarCollapsedSnapshot(): boolean {
  try {
    return localStorage.getItem("medquest_sidebar_collapsed") === "true";
  } catch {
    return false;
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isLoaded } = useAppUser();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isOfflineOpen, setIsOfflineOpen] = useState(false);
  const isCollapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    () => false
  );
  const { isOffline, forcedOffline } = useOfflineStatus();
  const { isZenMode, toggleZenMode } = useZenMode();

  const toggleCollapse = () => {
    try {
      localStorage.setItem("medquest_sidebar_collapsed", String(!isCollapsed));
      window.dispatchEvent(new Event(SIDEBAR_EVENT));
    } catch {}
  };

  return (
    <>
      <aside
        className={clsx(
          "app-sidebar hidden md:flex flex-col bg-surface h-full left-0 border-r border-line-subtle p-2.5 gap-3 z-10 select-none transition-[width] duration-200",
          isCollapsed ? "w-16" : "w-60"
        )}
      >
        {/* LOGO & TITULO */}
        <div
          className={clsx(
            "flex items-center border-b border-line-subtle/80 py-2.5",
            isCollapsed ? "justify-center px-1" : "justify-between px-2"
          )}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-primary text-white flex items-center justify-center shadow-xs shrink-0">
              <ClinicalIcon name="local_hospital" className="w-4 h-4" strokeWidth={2.2} />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <h1 className="font-bold text-sm text-ink-primary tracking-tight truncate">MedQuest</h1>
                <span className="text-[11px] text-ink-muted truncate">Residência Médica</span>
              </div>
            )}
          </div>
          {!isCollapsed && (
            <button
              type="button"
              onClick={toggleCollapse}
              className="p-1.5 rounded-lg text-ink-muted hover:text-ink-primary hover:bg-elevated transition-colors cursor-pointer"
              title="Recolher barra lateral"
              aria-label="Recolher barra lateral"
            >
              <ClinicalIcon name="chevron_left" className="w-4 h-4" />
            </button>
          )}
        </div>

        {isCollapsed && (
          <button
            type="button"
            onClick={toggleCollapse}
            className="mx-auto p-1.5 rounded-lg border border-line-subtle text-ink-muted hover:text-ink-primary hover:bg-elevated transition-colors cursor-pointer"
            title="Expandir barra lateral"
            aria-label="Expandir barra lateral"
          >
            <ClinicalIcon name="chevron_right" className="w-3.5 h-3.5" />
          </button>
        )}

        {/* NAVEGACAO PRINCIPAL */}
        <nav className="flex-1 flex flex-col gap-1 overflow-y-auto px-0.5 py-1" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onMouseEnter={() => prefetchRouteIntent(item.href, router, queryClient)}
                onFocus={() => prefetchRouteIntent(item.href, router, queryClient)}
                title={isCollapsed ? item.label : undefined}
                aria-current={isActive ? "page" : undefined}
                className={clsx(
                  "flex items-center rounded-xl transition-colors text-[13px] font-medium",
                  isCollapsed ? "justify-center py-2.5 px-2" : "gap-2.5 py-2 px-3",
                  isActive 
                    ? "bg-accent/10 text-ink-primary font-semibold border border-accent/25" 
                    : "text-ink-secondary hover:bg-elevated/70 hover:text-ink-primary"
                )}
              >
                <ClinicalIcon 
                  name={item.icon} 
                  className={clsx("w-4 h-4 shrink-0", isActive ? "text-accent" : "text-ink-muted")} 
                  strokeWidth={isActive ? 2.1 : 1.75} 
                />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* TELEMETRIA & RODAPE */}
        <div className="mt-auto flex flex-col gap-2 pt-2 border-t border-line-subtle/80">
          <div className={clsx("flex items-center gap-1 px-0.5", isCollapsed ? "flex-col" : "justify-between")}>
            <button
              onClick={() => setIsOfflineOpen(true)}
              className={clsx(
                "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xs border transition-colors text-left cursor-pointer",
                !isCollapsed && "flex-1 justify-start",
                isOffline || forcedOffline
                  ? "bg-warning/15 border-warning/40 text-warning font-semibold"
                  : "border-line-subtle text-ink-secondary hover:bg-elevated hover:text-ink-primary"
              )}
              title={forcedOffline ? "Modo Plantão Forçado Ativo" : isOffline ? "Modo Plantão (Offline Ativo)" : "Abrir Modo Plantão (Offline)"}
              aria-label={forcedOffline ? "Modo Plantão Forçado Ativo" : isOffline ? "Modo Plantão Offline Ativo" : "Abrir Modo Plantão"}
            >
              <ClinicalIcon name={isOffline || forcedOffline ? "cloud_off" : "cloud_download"} className="w-3.5 h-3.5 shrink-0" />
              {!isCollapsed && (
                <span className="text-[11px] font-mono-lab font-medium truncate">
                  {forcedOffline ? "Plantão (F)" : isOffline ? "Offline" : "Plantão"}
                </span>
              )}
            </button>

            <button
              onClick={toggleZenMode}
              className="flex items-center justify-center p-1.5 rounded-xs border border-line-subtle text-ink-secondary hover:bg-elevated hover:text-ink-primary transition-colors cursor-pointer"
              title={isZenMode ? "Sair do Modo Zen (Z)" : "Entrar no Modo Zen (Z)"}
              aria-label={isZenMode ? "Sair do modo Zen" : "Entrar no modo Zen"}
              aria-pressed={isZenMode}
            >
              <ClinicalIcon name={isZenMode ? "fullscreen_exit" : "fullscreen"} className="w-3.5 h-3.5" />
            </button>

            <div className="scale-90 opacity-85 hover:opacity-100 transition-opacity">
              <ThemeToggle />
            </div>
          </div>
          
          <button
            onClick={() => setIsModalOpen(true)}
            title={isCollapsed ? (isLoaded ? (user?.firstName || "Conta") : "Conta") : undefined}
            className={clsx(
              "flex items-center gap-2 py-2 rounded-xs border border-line-subtle hover:bg-elevated transition-colors w-full text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent",
              isCollapsed ? "justify-center px-1.5" : "justify-between px-2.5"
            )}
            aria-label="Minha Conta"
          >
            <div className="flex items-center gap-2 min-w-0">
              {isLoaded && user?.imageUrl ? (
                <div className="relative w-5 h-5 rounded-full overflow-hidden flex-shrink-0 ring-1 ring-line-subtle">
                  <Image src={user.imageUrl} alt="Avatar" fill sizes="20px" className="object-cover" />
                </div>
              ) : (
                <div className="w-5 h-5 rounded-full bg-elevated border border-line-subtle flex items-center justify-center flex-shrink-0">
                  <ClinicalIcon name="person" className="w-3 h-3 text-ink-muted" />
                </div>
              )}
              {!isCollapsed && (
                <span className="text-xs font-medium text-ink-primary truncate">
                  {isLoaded ? (user?.firstName || "Conta") : "Conta"}
                </span>
              )}
            </div>
            {!isCollapsed && <ClinicalIcon name="more_horiz" className="w-3.5 h-3.5 text-ink-muted opacity-60" />}
          </button>
        </div>
      </aside>
      
      <AccountModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      <OfflineModal isOpen={isOfflineOpen} onClose={() => setIsOfflineOpen(false)} />
    </>
  );
}

"use client";

import React, { createContext, useContext } from "react";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";

type UserResult = ReturnType<typeof useUser>;
type AuthResult = ReturnType<typeof useAuth>;
type ClerkResult = ReturnType<typeof useClerk>;

interface AppAuthContextValue {
  clerkEnabled: boolean;
  userState: UserResult;
  authState: AuthResult;
  signOut: ClerkResult["signOut"];
}

const FALLBACK_USER_STATE = {
  isLoaded: true,
  isSignedIn: false,
  user: null,
} as unknown as UserResult;

const FALLBACK_AUTH_STATE = {
  isLoaded: true,
  isSignedIn: false,
  userId: null,
  sessionId: null,
  sessionClaims: null,
  actor: null,
  orgId: null,
  orgRole: null,
  orgSlug: null,
  has: () => false,
  signOut: async () => {},
  getToken: async () => null,
} as unknown as AuthResult;

const FALLBACK_CONTEXT_VALUE: AppAuthContextValue = {
  clerkEnabled: false,
  userState: FALLBACK_USER_STATE,
  authState: FALLBACK_AUTH_STATE,
  signOut: (async () => {}) as unknown as ClerkResult["signOut"],
};

const AppAuthContext = createContext<AppAuthContextValue>(FALLBACK_CONTEXT_VALUE);

function ClerkAuthBridge({ children }: { children: React.ReactNode }) {
  const userState = useUser();
  const authState = useAuth();
  const { signOut } = useClerk();

  return (
    <AppAuthContext.Provider
      value={{
        clerkEnabled: true,
        userState,
        authState,
        signOut,
      }}
    >
      {children}
    </AppAuthContext.Provider>
  );
}

/**
 * Provedor unificado de estado de autenticação no cliente.
 * Quando `clerkEnabled` é false (modo preview/demo sem chaves), fornece estado
 * anônimo já carregado sem exigir <ClerkProvider> na árvore.
 */
export function AppAuthProvider({
  clerkEnabled,
  children,
}: {
  clerkEnabled: boolean;
  children: React.ReactNode;
}) {
  if (!clerkEnabled) {
    return (
      <AppAuthContext.Provider value={FALLBACK_CONTEXT_VALUE}>
        {children}
      </AppAuthContext.Provider>
    );
  }
  return <ClerkAuthBridge>{children}</ClerkAuthBridge>;
}

/** Substituto seguro para `useUser()` compatível com modo preview sem Clerk. */
export function useAppUser(): UserResult {
  return useContext(AppAuthContext).userState;
}

/** Substituto seguro para `useAuth()` compatível com modo preview sem Clerk. */
export function useAppAuth(): AuthResult {
  return useContext(AppAuthContext).authState;
}

/** Substituto seguro para `useClerk()` compatível com modo preview sem Clerk. */
export function useAppClerk(): { signOut: ClerkResult["signOut"]; clerkEnabled: boolean } {
  const ctx = useContext(AppAuthContext);
  return { signOut: ctx.signOut, clerkEnabled: ctx.clerkEnabled };
}

/** Indica se o provedor Clerk está montado na árvore atual. */
export function useIsClerkEnabled(): boolean {
  return useContext(AppAuthContext).clerkEnabled;
}

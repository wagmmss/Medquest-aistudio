import { existsSync } from "node:fs";
import { join } from "node:path";
import { auth, currentUser } from "@clerk/nextjs/server";

/**
 * Indica se o Clerk está ativo no servidor.
 * Em produção, é sempre obrigatório. Em desenvolvimento, exige chaves explícitas
 * ou o arquivo local de modo keyless (.clerk/.tmp/keyless.json); caso contrário,
 * ativa o fallback automático para Modo Preview/Demo (ex.: Google AI Studio sem .env).
 */
export function isClerkServerEnabled(): boolean {
  if (process.env.NODE_ENV === "production") {
    return true;
  }

  if (process.env.MEDQUEST_PREVIEW_NO_CLERK === "1") {
    return false;
  }

  const hasExplicitKeys = Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() &&
      process.env.CLERK_SECRET_KEY?.trim()
  );
  if (hasExplicitKeys) {
    return true;
  }

  const keylessCandidates = [
    join(process.cwd(), ".clerk", ".tmp", "keyless.json"),
    join(process.cwd(), "app", "frontend", ".clerk", ".tmp", "keyless.json"),
  ];

  try {
    return keylessCandidates.some((candidate) => existsSync(candidate));
  } catch {
    return false;
  }
}

/**
 * Retorna o estado de autenticação no servidor com fallback seguro quando
 * o Clerk está desativado em ambiente de desenvolvimento/preview.
 */
export async function getServerAuthState(): Promise<{
  userId: string | null;
  getToken: () => Promise<string | null>;
}> {
  if (!isClerkServerEnabled()) {
    return { userId: null, getToken: async () => null };
  }

  const session = await auth();
  return {
    userId: session.userId ?? null,
    getToken: () => session.getToken(),
  };
}

/**
 * Retorna o usuário atual do Clerk no servidor ou null quando em fallback demo.
 */
export async function getServerCurrentUser() {
  if (!isClerkServerEnabled()) {
    return null;
  }
  return currentUser();
}

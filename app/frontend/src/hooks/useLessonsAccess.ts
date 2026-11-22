"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAppAuth } from "@/lib/auth-client";

export function useLessonsAccess() {
  const { userId, isLoaded } = useAppAuth();
  const sessionKey = isLoaded ? (userId ?? "anon") : "loading";

  const { data, isLoading } = useQuery({
    queryKey: ["auth-me", sessionKey],
    queryFn: ({ signal }) => api.auth.getMe(signal),
    enabled: isLoaded,
    staleTime: 60_000,
    retry: false,
  });

  return {
    canAccessLessons: Boolean(data?.can_access_lessons),
    isLoading: !isLoaded || isLoading,
  };
}

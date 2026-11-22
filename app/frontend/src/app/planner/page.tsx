import { PlannerShell } from "./PlannerShell";
import type { PlannerOrganizationMode } from "@/types/api";

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ intensive?: string; org?: string }>;
}) {
  const sp = await searchParams;
  const isIntensive = sp.intensive === "true";
  const orgParam: PlannerOrganizationMode | undefined =
    sp.org === "internato" ? "internato" : sp.org === "geral" ? "geral" : undefined;

  return <PlannerShell isIntensive={isIntensive} initialOrganization={orgParam} />;
}

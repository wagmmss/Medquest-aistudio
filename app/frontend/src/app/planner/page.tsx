import { PlannerShell } from "./PlannerShell";

export default async function PlannerPage({ searchParams }: { searchParams: Promise<{ intensive?: string }> }) {
  const sp = await searchParams;
  const isIntensive = sp.intensive === "true";

  return <PlannerShell isIntensive={isIntensive} />;
}

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TemaRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ subtema?: string | string[] }>;
}) {
  const params = await searchParams;
  const subtema = typeof params?.subtema === "string" ? params.subtema : null;
  const target = new URLSearchParams({ tab: "cobertura" });
  if (subtema) {
    target.set("subtema", subtema);
  }
  redirect(`/analise?${target.toString()}`);
}

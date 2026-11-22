import { SimuladoClient } from "./SimuladoClient";

export default async function SimuladoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const rawParams = await searchParams;
  const initialFilters: Record<string, string | string[]> = {};
  
  for (const key in rawParams) {
    const val = rawParams[key];
    if (val !== undefined) {
      initialFilters[key] = val;
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full overflow-y-auto">
      <SimuladoClient initialFilters={initialFilters} />
    </div>
  );
}

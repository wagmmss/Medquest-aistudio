import { SearchClient } from "./SearchClient";

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    area?: string;
    institution?: string;
    year?: string;
    has_images?: string;
    scope?: string;
  }>;
}

export default async function BuscarPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const initialScope =
    params.scope === "aulas" || params.scope === "questoes" ? params.scope : "all";

  return (
    <SearchClient
      initialQuery={params.q || ""}
      initialArea={params.area || "Todas"}
      initialInstitution={params.institution || "Todas"}
      initialYear={params.year || "Todos"}
      initialWithImage={params.has_images === "true"}
      initialScope={initialScope}
    />
  );
}

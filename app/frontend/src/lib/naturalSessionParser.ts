export interface ParsedSessionChip {
  key: string;
  label: string;
  category: "limit" | "institution" | "area" | "subtema" | "status" | "year" | "extra";
}

export interface NaturalSessionParseResult {
  filters: Record<string, string | string[]>;
  chips: ParsedSessionChip[];
  hasMatches: boolean;
  isValid: boolean;
}

export interface NaturalSessionCatalog {
  subtemas?: Array<{ subtema: string; n?: number }>;
  areas?: Array<{ area: string; n?: number }>;
  institutions?: Array<{ institution_code: string; institution_label?: string }>;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const INSTITUTION_ALIASES: Array<{ code: string; label: string; patterns: RegExp[] }> = [
  { code: "USP-SP", label: "USP-SP", patterns: [/\busp[\s-]*sp\b/i, /\bfmusp\b/i, /\busp\s+capital\b/i, /\busp\b(?![\s-]*rp|\s+ribeir)/i] },
  { code: "USP-RP", label: "USP-RP", patterns: [/\busp[\s-]*rp\b/i, /\bfmrp\b/i, /\bribeir[aã]o\s+preto\b/i] },
  { code: "UNICAMP", label: "UNICAMP", patterns: [/\bunicamp\b/i] },
  { code: "UNIFESP", label: "UNIFESP", patterns: [/\bunifesp\b/i, /\bepm\b/i, /\bescola\s+paulista\b/i] },
  { code: "SUS-SP", label: "SUS-SP", patterns: [/\bsus[\s-]*sp\b/i, /\bses[\s-]*sp\b/i] },
  { code: "ENARE", label: "ENARE", patterns: [/\benare\b/i, /\bebserh\b/i] },
  { code: "EINSTEIN", label: "Einstein", patterns: [/\beinstein\b/i, /\bhiae\b/i] },
  { code: "HSL", label: "Sírio-Libanês", patterns: [/\bs[ií]rio\b/i, /\bhsl\b/i] },
  { code: "IAMSPE", label: "IAMSPE", patterns: [/\biamspe\b/i, /\bservidor\s+estadual\b/i] },
  { code: "SCMSP", label: "Santa Casa SP", patterns: [/\bsanta\s+casa\b/i, /\bscm[\s-]*sp\b/i, /\bscmsp\b/i] },
  { code: "FAMEMA", label: "FAMEMA", patterns: [/\bfamema\b/i] },
  { code: "FAMERP", label: "FAMERP", patterns: [/\bfamerp\b/i] },
  { code: "SES-PE", label: "SES-PE", patterns: [/\bses[\s-]*pe\b/i] },
  { code: "AMRIGS", label: "AMRIGS", patterns: [/\bamrigs\b/i] },
  { code: "INEP", label: "INEP / Revalida", patterns: [/\binep\b/i, /\brevalida\b/i] },
  { code: "FMABC", label: "FMABC", patterns: [/\bfmabc\b/i, /\babc\b/i] },
  { code: "UFCSPA", label: "UFCSPA", patterns: [/\bufcspa\b/i] },
  { code: "PUC", label: "PUC", patterns: [/\bpuc\b/i] },
  { code: "FMJ", label: "FMJ", patterns: [/\bfmj\b/i] },
  { code: "AMP", label: "AMP", patterns: [/\bamp\b/i] },
];

const AREA_ALIASES: Array<{ area: string; patterns: RegExp[] }> = [
  { area: "Clínica Médica", patterns: [/\bcl[ií]nica\s+m[eé]dica\b/i, /\bcl[ií]nica\b/i] },
  { area: "Cirurgia", patterns: [/\bcirurgia\s+geral\b/i, /\bcirurgia\b/i] },
  {
    area: "Ginecologia e Obstetrícia",
    patterns: [/\bginecologia\s+e\s+obstetr[ií]cia\b/i, /\bginecologia\b/i, /\bobstetr[ií]cia\b/i, /\bg\.?o\.?\b/i],
  },
  { area: "Pediatria", patterns: [/\bpediatria\b/i, /\bneonatologia\b/i, /\bpuericultura\b/i] },
  {
    area: "Medicina Preventiva",
    patterns: [/\bmedicina\s+preventiva\b/i, /\bpreventiva\b/i, /\bsa[uú]de\s+coletiva\b/i, /\bepidemiologia\b/i],
  },
];

const MEDICAL_SYNONYM_TO_SUBTEMA: Array<{ pattern: RegExp; area?: string; keywords: string[]; fallbackLabel: string }> = [
  { pattern: /\bcardiologia\b|\bcardio\b|\bicc\b|\bsca\b|\binfarto\b|\biam\b/i, area: "Clínica Médica", keywords: ["coronarian", "insuficiencia cardiaca", "hipertensao", "arritmia", "cardi"], fallbackLabel: "Síndromes Coronarianas Agudas" },
  { pattern: /\bpneumologia\b|\bpneumo\b|\basma\b|\bdpoc\b/i, area: "Clínica Médica", keywords: ["asma", "dpoc", "pneumonia", " derrame pleural", "tromboembolismo"], fallbackLabel: "Asma e DPOC" },
  { pattern: /\bnefrologia\b|\bnefro\b|\bira\b|\bdrc\b/i, area: "Clínica Médica", keywords: ["lesao renal", "doenca renal", "glomerulo", "disturbios hidroeletroliticos"], fallbackLabel: "Lesão Renal Aguda e Doença Renal Crônica" },
  { pattern: /\binfectologia\b|\binfecto\b|\bsepse\b|\bhiv\b|\bdengue\b|\btuberculose\b/i, area: "Clínica Médica", keywords: ["sepse", "arboviroses", "hiv", "tuberculose", "endocardite", "meningite"], fallbackLabel: "Sepse e Choque Séptico" },
  { pattern: /\bgastroenterologia\b|\bgastro\b|\bcirrose\b|\bhemorragia\s+digestiva\b/i, area: "Clínica Médica", keywords: ["hemorragia digestiva", "cirrose", "hepatite", "pancreatite", "doenca inflamatoria"], fallbackLabel: "Hemorragia Digestiva Alta e Baixa" },
  { pattern: /\bendocrinologia\b|\bendocrino\b|\bdiabetes\b|\btireoide\b/i, area: "Clínica Médica", keywords: ["diabetes", "tireoid", "adrenal", "obesidade"], fallbackLabel: "Diabetes Mellitus e Emergências Hiperglicêmicas" },
  { pattern: /\bneurologia\b|\bneuro\b|\bavc\b|\bcefaleia\b|\bcomas?\b/i, area: "Clínica Médica", keywords: ["acidente vascular", "cefaleia", "epilepsia", "neuropatia"], fallbackLabel: "Acidente Vascular Cerebral (AVC)" },
  { pattern: /\btrauma\b|\bpolitrauma\b|\batls\b|\bxabcde\b/i, area: "Cirurgia", keywords: ["politraumatizado", "xabcde", "trauma"], fallbackLabel: "Atendimento Inicial ao Politraumatizado (Protocolo xABCDE)" },
  { pattern: /\babdome\s+agudo\b|\bapendicite\b|\bcolecistite\b|\bdiverticulite\b/i, area: "Cirurgia", keywords: ["abdome agudo", "apendicite", "colecistite", "obstrutivo", "perfurativo"], fallbackLabel: "Abdome Agudo Inflamatório" },
  { pattern: /\bqueimaduras?\b|\bqueimado\b/i, area: "Cirurgia", keywords: ["queimadura", "grande queimado"], fallbackLabel: "Queimaduras e Grande Queimado" },
  { pattern: /\bpr[eé][\s-]*natal\b/i, area: "Ginecologia e Obstetrícia", keywords: ["pre-natal", "assistencia pre-natal"], fallbackLabel: "Assistência Pré-Natal e Exames Complementares" },
  { pattern: /\bparto\b|\btrabalho\s+de\s+parto\b|\bhemorragia\s+p[oó]s[\s-]*parto\b|\bhpp\b/i, area: "Ginecologia e Obstetrícia", keywords: ["parto", "hemorragia pos-parto"], fallbackLabel: "Assistência ao Parto e Hemorragia Pós-Parto" },
  { pattern: /\bpr[eé][\s-]*ecl[aâ]mpsia\b|\bdheg\b|\bhipertens[aã]o\s+na\s+gesta/i, area: "Ginecologia e Obstetrícia", keywords: ["hipertensivas da gestacao", "pre-eclampsia", "eclampsia"], fallbackLabel: "Síndromes Hipertensivas da Gestação" },
  { pattern: /\bbronquiolite\b|\bsibil[aâ]ncia\b/i, area: "Pediatria", keywords: ["bronquiolite", "sibilancia"], fallbackLabel: "Bronquiolite Viral Aguda e Sibilância no Lactente" },
  { pattern: /\bvacina[cç][aã]o\b|\bvacinas?\b|\bpni\b|\bimuniza[cç][aã]o\b/i, area: "Pediatria", keywords: ["imunizacoes", "vacinal", "pni"], fallbackLabel: "Calendário Nacional de Vacinação (PNI)" },
  { pattern: /\breanima[cç][aã]o\s+neonatal\b/i, area: "Pediatria", keywords: ["reanimacao neonatal"], fallbackLabel: "Reanimação Neonatal" },
  { pattern: /\bvigil[aâ]ncia\b|\bnotifica[cç][aã]o\b|\bsinan\b|\bestudos?\s+epidemiol/i, area: "Medicina Preventiva", keywords: ["vigilancia", "estudos epidemiologicos", "atencao primaria"], fallbackLabel: "Vigilância em Saúde e Notificação Compulsória" },
];

export function parseNaturalSessionPrompt(
  prompt: string,
  catalog: NaturalSessionCatalog | string[] = {},
  baseFilters: Record<string, string | string[]> = {}
): NaturalSessionParseResult {
  const raw = (prompt || "").trim();
  if (!raw) {
    return { filters: { ...baseFilters }, chips: [], hasMatches: false, isValid: false };
  }

  const norm = normalize(raw);
  const nextFilters: Record<string, string | string[]> = {};
  const chips: ParsedSessionChip[] = [];

  // 1. Quantidade (limit)
  const limitMatch =
    raw.match(/\b(\d{1,3})\s*(?:quest[oõ]es?|q\b|itens?|casos?)/i) ||
    raw.match(/\bbloco\s+de\s+(\d{1,3})\b/i) ||
    raw.match(/^(\d{1,3})\b/);

  if (limitMatch) {
    const parsedNum = Math.max(5, Math.min(200, parseInt(limitMatch[1], 10)));
    nextFilters.limit = String(parsedNum);
    chips.push({
      key: "limit",
      label: `${parsedNum} questões`,
      category: "limit",
    });
  } else if (baseFilters.limit) {
    nextFilters.limit = baseFilters.limit;
  } else {
    nextFilters.limit = "20";
  }

  // 2. Bancas / Instituições
  const matchedInstitutions: string[] = [];
  for (const inst of INSTITUTION_ALIASES) {
    if (inst.patterns.some((rx) => rx.test(raw) || rx.test(norm))) {
      if (!matchedInstitutions.includes(inst.code)) {
        matchedInstitutions.push(inst.code);
        chips.push({
          key: `inst:${inst.code}`,
          label: `Banca: ${inst.label}`,
          category: "institution",
        });
      }
    }
  }
  if (matchedInstitutions.length === 1) {
    nextFilters.institution = matchedInstitutions[0];
  } else if (matchedInstitutions.length > 1) {
    nextFilters.institution = matchedInstitutions;
  }

  // 3. Status / Modo
  if (/\b(errei|erradas?|erros?|caderno\s+de\s+erros|pendentes?|n[aã]o\s+resolvidas?)\b/i.test(norm)) {
    nextFilters.status = "wrong";
    nextFilters.unresolved_only = "true";
    nextFilters.wrong_only = "true";
    delete nextFilters.unanswered_only;
    chips.push({
      key: "status:wrong",
      label: "Status: Que errei (Caderno de Erros)",
      category: "status",
    });
  } else if (/\b(revis[aã]o|fsrs|srs|vencidas?|repeti[cç][aã]o\s+espa[cç]ada)\b/i.test(norm)) {
    nextFilters.status = "srs_due";
    nextFilters.srs_due = "true";
    delete nextFilters.unanswered_only;
    chips.push({
      key: "status:srs_due",
      label: "Status: Revisão FSRS",
      category: "status",
    });
  } else if (/\b(favoritas?|favoritos?|salvas?)\b/i.test(norm)) {
    nextFilters.status = "favorite";
    nextFilters.favorite = "true";
    delete nextFilters.unanswered_only;
    chips.push({
      key: "status:favorite",
      label: "Status: Favoritas",
      category: "status",
    });
  } else if (/\b(in[eé]ditas?|n[aã]o\s+respondidas?|novas?|nunca\s+fiz)\b/i.test(norm)) {
    nextFilters.status = "unanswered";
    nextFilters.unanswered_only = "true";
    chips.push({
      key: "status:unanswered",
      label: "Status: Não respondidas",
      category: "status",
    });
  } else if (/\b(todas\s+as\s+quest[oõ]es|qualquer\s+status|incluindo\s+respondidas)\b/i.test(norm)) {
    nextFilters.status = "all";
    delete nextFilters.unanswered_only;
    chips.push({
      key: "status:all",
      label: "Status: Todas",
      category: "status",
    });
  } else {
    nextFilters.status = "unanswered";
    nextFilters.unanswered_only = "true";
  }

  if (/\b(adaptativ[oa]|inteligente)\b/i.test(norm)) {
    nextFilters.mode = "adaptive";
    chips.push({
      key: "mode:adaptive",
      label: "Modo Adaptativo",
      category: "status",
    });
  }

  // 4. Grande Área
  const matchedAreas: string[] = [];
  for (const item of AREA_ALIASES) {
    if (item.patterns.some((rx) => rx.test(raw) || rx.test(norm))) {
      if (!matchedAreas.includes(item.area)) {
        matchedAreas.push(item.area);
      }
    }
  }

  // 5. Subtema (direto do catálogo ou via sinônimo médico)
  const matchedSubtemas: string[] = [];
  const availableSubtemas = Array.isArray(catalog)
    ? catalog.map((subtema) => ({ subtema }))
    : catalog.subtemas || [];

  for (const item of availableSubtemas) {
    const subNorm = normalize(item.subtema);
    if (subNorm.length >= 4 && norm.includes(subNorm)) {
      if (!matchedSubtemas.includes(item.subtema)) {
        matchedSubtemas.push(item.subtema);
      }
    }
  }

  for (const syn of MEDICAL_SYNONYM_TO_SUBTEMA) {
    if (syn.pattern.test(raw) || syn.pattern.test(norm)) {
      const fromCatalog = availableSubtemas.find((s) => {
        const sNorm = normalize(s.subtema);
        return syn.keywords.some((kw) => sNorm.includes(normalize(kw)));
      });
      const resolvedSubtema = fromCatalog ? fromCatalog.subtema : syn.fallbackLabel;
      if (!matchedSubtemas.includes(resolvedSubtema)) {
        matchedSubtemas.push(resolvedSubtema);
      }
      if (syn.area && matchedAreas.length === 0) {
        matchedAreas.push(syn.area);
      }
    }
  }

  // Fallback por tokens clínicos contra o catálogo real de subtemas (ex.: "pneumonia", "apendicite", "hipertensao")
  if (matchedSubtemas.length === 0 && availableSubtemas.length > 0) {
    const STOPWORDS = new Set([
      "questoes", "questao", "itens", "casos", "bloco", "sobre", "para", "com", "sem",
      "errei", "erradas", "errado", "erros", "pendentes", "resolvidas", "revisao", "revisoes",
      "vencidas", "vencida", "favoritas", "favoritos", "salvas", "ineditas", "novas", "nunca",
      "todas", "qualquer", "status", "adaptativo", "adaptativa", "inteligente",
      "discursivas", "discursiva", "abertas", "aberta", "imagens", "imagem", "laudos",
      "clinica", "medica", "cirurgia", "geral", "ginecologia", "obstetricia", "pediatria",
      "preventiva", "saude", "coletiva", "epidemiologia",
    ]);
    const instStop = new Set(matchedInstitutions.map((c) => normalize(c)));
    const tokens = norm
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !STOPWORDS.has(t) && !instStop.has(t));

    if (tokens.length > 0) {
      const scored = availableSubtemas
        .map((item) => {
          const sNorm = normalize(item.subtema);
          const hits = tokens.filter((t) => sNorm.includes(t)).length;
          return { subtema: item.subtema, hits };
        })
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits);

      const bestHits = scored[0]?.hits ?? 0;
      if (bestHits > 0) {
        for (const cand of scored.filter((x) => x.hits === bestHits).slice(0, 3)) {
          if (!matchedSubtemas.includes(cand.subtema)) {
            matchedSubtemas.push(cand.subtema);
          }
        }
      }
    }
  }

  if (matchedAreas.length > 0) {
    nextFilters.area = matchedAreas.length === 1 ? matchedAreas[0] : matchedAreas;
    for (const a of matchedAreas) {
      chips.push({
        key: `area:${a}`,
        label: `Área: ${a}`,
        category: "area",
      });
    }
  }

  if (matchedSubtemas.length > 0) {
    nextFilters.subtema = matchedSubtemas.length === 1 ? matchedSubtemas[0] : matchedSubtemas;
    for (const s of matchedSubtemas) {
      chips.push({
        key: `subtema:${s}`,
        label: `Foco: ${s}`,
        category: "subtema",
      });
    }
  }

  // 6. Ano da prova
  const yearMatches = Array.from(raw.matchAll(/\b(201[89]|202[0-6])\b/g)).map((m) => m[1]);
  const uniqueYears = Array.from(new Set(yearMatches));
  if (uniqueYears.length > 0) {
    nextFilters.year = uniqueYears.length === 1 ? uniqueYears[0] : uniqueYears;
    chips.push({
      key: `year:${uniqueYears.join(",")}`,
      label: `Ano: ${uniqueYears.join(", ")}`,
      category: "year",
    });
  }

  // 7. Extras (Imagem / Tipo)
  if (/\b(com\s+imagens?|com\s+imagem|laudos?|ecg|eletrocardiograma|raio[\s-]*x|rx|tomografia)\b/i.test(norm)) {
    nextFilters.has_images = "true";
    chips.push({
      key: "extra:has_images",
      label: "Com Imagem/Exame",
      category: "extra",
    });
  }

  if (/\b(discursivas?|abertas?)\b/i.test(norm)) {
    nextFilters.question_type = "discursiva";
    chips.push({
      key: "extra:discursive",
      label: "Discursivas",
      category: "extra",
    });
  }

  return {
    filters: nextFilters,
    chips,
    hasMatches: chips.length > 0,
    isValid: chips.length > 0,
  };
}

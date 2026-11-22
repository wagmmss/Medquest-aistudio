import { AttemptResult, QuestionDetail } from "@/types/api";

export interface AnkiCardPayload {
  deckName: string;
  front: string;
  back: string;
  tags: string[];
}

function sanitizeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function sanitizeTag(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function buildAnkiCardFromQuestion(
  question: Pick<QuestionDetail, "id" | "stem" | "area" | "subtema" | "institution_code" | "year" | "alternatives">,
  attemptResult: Pick<AttemptResult, "correct_letter" | "explanation">,
  userNote?: string
): AnkiCardPayload {
  const correctAlt = (question.alternatives || []).find(
    (a) => a.letter.toUpperCase() === (attemptResult.correct_letter || "").toUpperCase()
  );
  const header = [question.institution_code, question.year, question.subtema || question.area]
    .filter(Boolean)
    .join(" • ");

  const front = [
    `<b>[MedQuest Q#${question.id}]</b> ${sanitizeHtmlText(header)}`,
    `<br><br>${sanitizeHtmlText((question.stem || "").slice(0, 900))}`,
  ].join("");

  const answerText = correctAlt
    ? `<b>Gabarito (${correctAlt.letter}):</b> ${sanitizeHtmlText(correctAlt.text)}`
    : `<b>Gabarito:</b> ${sanitizeHtmlText(attemptResult.correct_letter || "-")}`;

  const noteBlock = userNote?.trim()
    ? `<br><br><b>Meu Macete:</b> ${sanitizeHtmlText(userNote.trim())}`
    : "";

  const explanationSnippet = (attemptResult.explanation || "").trim().slice(0, 1200);
  const expBlock = explanationSnippet
    ? `<br><br><b>Comentário:</b> ${sanitizeHtmlText(explanationSnippet)}`
    : "";

  const tags = ["medquest", "caderno_erros"];
  if (question.area) tags.push(`area::${sanitizeTag(question.area)}`);
  if (question.subtema) tags.push(`tema::${sanitizeTag(question.subtema)}`);
  if (question.institution_code) tags.push(`banca::${sanitizeTag(question.institution_code)}`);

  return {
    deckName: "MedQuest - Caderno de Erros",
    front,
    back: `${answerText}${noteBlock}${expBlock}`,
    tags: tags.filter(Boolean),
  };
}

export function formatAnkiTsv(card: AnkiCardPayload): string {
  const cleanField = (s: string) => s.replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
  return `${cleanField(card.front)}\t${cleanField(card.back)}\t${card.tags.join(" ")}\n`;
}

export async function sendCardToAnki(card: AnkiCardPayload): Promise<"ankiconnect" | "tsv_download"> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    await fetch("http://127.0.0.1:8765", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        action: "createDeck",
        version: 6,
        params: { deck: card.deckName },
      }),
    });
    const res = await fetch("http://127.0.0.1:8765", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        action: "addNote",
        version: 6,
        params: {
          note: {
            deckName: card.deckName,
            modelName: "Basic",
            fields: { Front: card.front, Back: card.back },
            tags: card.tags,
          },
        },
      }),
    });
    clearTimeout(timeout);
    if (res.ok) {
      const json = (await res.json()) as { error?: string | null };
      if (!json.error) {
        return "ankiconnect";
      }
    }
  } catch {
    // AnkiConnect não está rodando localmente; cai no download .tsv compatível com Anki Desktop
  }

  const tsv = formatAnkiTsv(card);
  const blob = new Blob([tsv], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `medquest-anki-${Date.now()}.tsv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return "tsv_download";
}

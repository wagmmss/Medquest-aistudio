import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function loadAnkiExport() {
  const source = readFileSync(new URL("../../src/lib/ankiExport.ts", import.meta.url), "utf8");
  const exports = {};
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(transpiled, { exports });
  return exports;
}

test("buildAnkiCardFromQuestion builds escaped Front/Back and normalized tags", () => {
  const { buildAnkiCardFromQuestion, formatAnkiTsv } = loadAnkiExport();
  const card = buildAnkiCardFromQuestion(
    {
      id: 42,
      stem: "Paciente com <dispneia> súbita após viagem.",
      area: "Clínica Médica",
      subtema: "Tromboembolismo Pulmonar",
      institution_code: "USP-SP",
      year: 2025,
      alternatives: [
        { letter: "A", text: "Anticoagulação plena" },
        { letter: "B", text: "Alta imediata" },
      ],
    },
    {
      correct_letter: "A",
      explanation: "TEP confirmado exige anticoagulação imediata.",
    },
    "Escore de Wells > 4 = alta probabilidade"
  );

  assert.equal(card.deckName, "MedQuest - Caderno de Erros");
  assert.ok(card.front.includes("Q#42"));
  assert.ok(card.front.includes("&lt;dispneia&gt;"));
  assert.ok(card.back.includes("Gabarito (A):"));
  assert.ok(card.back.includes("Meu Macete:"));
  assert.ok(card.tags.includes("area::clinica_medica"));
  assert.ok(card.tags.includes("tema::tromboembolismo_pulmonar"));
  assert.ok(card.tags.includes("banca::usp_sp"));

  const tsv = formatAnkiTsv(card);
  assert.equal(tsv.split("\t").length, 3);
});

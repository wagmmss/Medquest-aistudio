import test from "node:test";
import assert from "node:assert/strict";
import { parseNaturalSessionPrompt } from "../../src/lib/naturalSessionParser.ts";

test("parseNaturalSessionPrompt parses quantity, area, institution, and wrong status", () => {
  const res = parseNaturalSessionPrompt("15 questões de GO da UNICAMP que errei");
  assert.equal(res.isValid, true);
  assert.equal(res.filters.limit, "15");
  assert.equal(res.filters.area, "Ginecologia e Obstetrícia");
  assert.equal(res.filters.institution, "UNICAMP");
  assert.equal(res.filters.status, "wrong");
});

test("parseNaturalSessionPrompt parses trauma subtema and USP-SP institution", () => {
  const res = parseNaturalSessionPrompt("20 de trauma na USP-SP não respondidas", ["Trauma"]);
  assert.equal(res.isValid, true);
  assert.equal(res.filters.limit, "20");
  assert.equal(res.filters.area, "Cirurgia");
  assert.equal(res.filters.subtema, "Trauma");
  assert.equal(res.filters.institution, "USP-SP");
  assert.equal(res.filters.status, "unanswered");
  assert.equal(res.filters.unanswered_only, "true");
});

test("parseNaturalSessionPrompt parses FSRS due status and pediatrics area", () => {
  const res = parseNaturalSessionPrompt("10 revisões vencidas de pediatria");
  assert.equal(res.isValid, true);
  assert.equal(res.filters.limit, "10");
  assert.equal(res.filters.area, "Pediatria");
  assert.equal(res.filters.status, "srs_due");
});

test("parseNaturalSessionPrompt returns isValid=false on empty prompt", () => {
  const res = parseNaturalSessionPrompt("   ");
  assert.equal(res.isValid, false);
  assert.equal(res.chips.length, 0);
});

test("parseNaturalSessionPrompt matches partial clinical topics against catalog subtemas and SCMSP", () => {
  const catalog = [
    "Pneumonia Adquirida na Comunidade (PAC)",
    "Asma Brônquica",
    "Abdome Agudo Inflamatório",
  ];
  const res = parseNaturalSessionPrompt("pneumonia na Santa Casa", catalog);
  assert.equal(res.isValid, true);
  assert.equal(res.filters.institution, "SCMSP");
  assert.equal(res.filters.subtema, "Pneumonia Adquirida na Comunidade (PAC)");
});

test("parseNaturalSessionPrompt maps discursivas to backend question_type discursiva", () => {
  const res = parseNaturalSessionPrompt("discursivas de pediatria");
  assert.equal(res.isValid, true);
  assert.equal(res.filters.area, "Pediatria");
  assert.equal(res.filters.question_type, "discursiva");
});

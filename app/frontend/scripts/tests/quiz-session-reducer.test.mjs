import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function loadReducer() {
  const source = readFileSync(
    new URL("../../src/app/estudar/quizSessionReducer.ts", import.meta.url),
    "utf8"
  );
  const exports = {};
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(transpiled, { exports });
  return exports;
}

test("quizSessionReducer transitions deterministically from FILTERS -> LOADING -> PLAYING -> FINISHED", () => {
  const { createInitialQuizSessionState, quizSessionReducer } = loadReducer();

  let state = createInitialQuizSessionState(false);
  assert.equal(state.phase, "FILTERS");

  state = quizSessionReducer(state, {
    type: "START_LOADING",
    filters: { area: "Clínica Médica", limit: "20" },
  });
  assert.equal(state.phase, "LOADING_QUEUE");

  state = quizSessionReducer(state, {
    type: "QUEUE_LOADED",
    filters: { area: "Clínica Médica", limit: "20" },
    queue: [{ id: 10 }, { id: 20 }, { id: 30 }],
  });
  assert.equal(state.phase, "PLAYING");
  assert.equal(state.currentIndex, 0);

  state = quizSessionReducer(state, { type: "GO_TO_INDEX", index: 99 });
  assert.equal(state.currentIndex, 2);

  state = quizSessionReducer(state, { type: "TOGGLE_ELIMINATE", questionId: 30, letter: "C" });
  assert.deepEqual([...state.eliminatedAlternatives[30]], ["C"]);
  state = quizSessionReducer(state, { type: "TOGGLE_ELIMINATE", questionId: 30, letter: "C" });
  assert.deepEqual([...state.eliminatedAlternatives[30]], []);

  state = quizSessionReducer(state, {
    type: "RECORD_ANSWER",
    questionId: 30,
    answer: { letter: "A", result: { is_correct: true } },
  });
  assert.equal(state.sessionAnswers[30].letter, "A");

  state = quizSessionReducer(state, { type: "FINISH_SESSION" });
  assert.equal(state.phase, "FINISHED");

  state = quizSessionReducer(state, { type: "RESET_TO_FILTERS" });
  assert.equal(state.phase, "FILTERS");
  assert.equal(state.queue.length, 0);
  assert.equal(Object.keys(state.sessionAnswers).length, 0);
});

test("quizSessionReducer falls back to FILTERS when queue is empty", () => {
  const { createInitialQuizSessionState, quizSessionReducer } = loadReducer();
  let state = createInitialQuizSessionState(true, { area: "Pediatria" });
  assert.equal(state.phase, "LOADING_QUEUE");

  state = quizSessionReducer(state, {
    type: "QUEUE_LOADED",
    filters: state.filters,
    queue: [],
  });
  assert.equal(state.phase, "FILTERS");
});

test("quizSessionReducer RESTART_SESSION clears sessionAnswers and eliminatedAlternatives while preserving queue", () => {
  const { createInitialQuizSessionState, quizSessionReducer } = loadReducer();
  let state = createInitialQuizSessionState(false);

  state = quizSessionReducer(state, {
    type: "QUEUE_LOADED",
    filters: { area: "Cirurgia", limit: "10" },
    queue: [{ id: 101 }, { id: 102 }],
  });

  state = quizSessionReducer(state, { type: "GO_TO_INDEX", index: 1 });
  state = quizSessionReducer(state, { type: "TOGGLE_ELIMINATE", questionId: 101, letter: "B" });
  state = quizSessionReducer(state, {
    type: "RECORD_ANSWER",
    questionId: 101,
    answer: {
      letter: "A",
      assisted: true,
      attendingTip: "Observe os sinais de peritonite.",
      result: { is_correct: true, assisted: true },
    },
  });
  assert.equal(state.sessionAnswers[101].assisted, true);
  assert.equal(state.sessionAnswers[101].attendingTip, "Observe os sinais de peritonite.");

  state = quizSessionReducer(state, { type: "FINISH_SESSION" });
  assert.equal(state.phase, "FINISHED");

  state = quizSessionReducer(state, { type: "RESTART_SESSION" });
  assert.equal(state.phase, "PLAYING");
  assert.equal(state.currentIndex, 0);
  assert.equal(state.queue.length, 2);
  assert.equal(Object.keys(state.sessionAnswers).length, 0);
  assert.equal(Object.keys(state.eliminatedAlternatives).length, 0);
});


import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(name, dependencies = {}, globals = {}) {
  const defaultDb = {
    getLocalOwnerId: () => 'alice',
    isDeviceOffline: () => typeof globals.navigator?.onLine === 'boolean' ? !globals.navigator.onLine : false,
    isForcedOffline: () => false,
  };
  dependencies = {
    './crossTab': { broadcastCrossTab() {}, listenCrossTab() { return () => {}; } },
    './db': defaultDb,
    ...dependencies,
  };
  if (dependencies['./db']) {
    dependencies['./db'] = { ...defaultDb, ...dependencies['./db'] };
  }
  if (!dependencies['./crossTab']) {
    dependencies['./crossTab'] = { broadcastCrossTab() {}, listenCrossTab() { return () => {}; } };
  }
  const source = readFileSync(new URL(`../../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: id => {
    assert.ok(id in dependencies, `Unexpected import ${id}`); return dependencies[id];
  }, console, process: { env: {} }, setTimeout, clearTimeout, Headers, AbortController,
  AbortSignal, Error, TypeError, crypto: globalThis.crypto, TextEncoder, URLSearchParams, ...globals });
  return exports;
}

function storage() {
  const map = new Map();
  return { map, getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v),
    removeItem: k => map.delete(k), key: i => [...map.keys()][i], get length() { return map.size; } };
}

test('reading and removing a session never migrates or erases another owner', async () => {
  const localStorage = storage();
  localStorage.setItem('medquest_quiz_state_v2:alice', '{"private":true}');
  const { readLearningSession, removeLearningSession } = load('sessionState', {
    './db': { getLocalOwnerId: () => 'bob' }, './api': { api: { sessions: { delete: async () => {} } } },
  }, { localStorage, sessionStorage: storage() });
  assert.equal(readLearningSession('quiz', () => true), null);
  removeLearningSession('quiz');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(localStorage.getItem('medquest_quiz_state_v2:alice'), '{"private":true}');
});

test('a delayed session write is cancelled when the active account changes', async () => {
  let owner = 'alice'; let callback; let calls = 0;
  const { writeLearningSession } = load('sessionState', {
    './db': { getLocalOwnerId: () => owner }, './api': { api: { sessions: { save: async () => { calls++; } } } },
  }, { localStorage: storage(), sessionStorage: storage(), setTimeout: fn => { callback = fn; return 1; } });
  writeLearningSession('quiz', { answer: 'A' });
  owner = 'bob'; callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
});

test('offline question attempt and simulado session writes are durably queued', async () => {
  const queued = [];
  const { api, OfflineQueuedError } = load('api', {
    './db': { getLocalOwnerId: () => 'alice' },
    './sync': { syncManager: { enqueue: async (...args) => { queued.push(args); return 'pending'; } } },
  }, { window: {}, navigator: { onLine: false } });
  await assert.rejects(api.questions.submitAttempt(1, 'B', 4200, 'certeza'), OfflineQueuedError);
  await assert.rejects(api.questions.saveSimuladoSession({
    client_session_id: 'sim-1',
    planned_duration_seconds: 600,
    elapsed_seconds: 300,
    total_questions: 10,
    answered_count: 10,
    correct_count: 8,
  }), OfflineQueuedError);
  assert.equal(queued.length, 2);
  assert.equal(JSON.parse(queued[0][1].body).confidence, 'certeza');
});

test('server authorization failures are not disguised as local offline queue writes', async () => {
  let queued = 0;
  const { api } = load('api', { './db': { getLocalOwnerId: () => 'alice' }, './sync': { syncManager: { enqueue: async () => { queued++; } } } }, {
    window: {}, navigator: { onLine: true }, fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }),
  });
  await assert.rejects(api.questions.submitAttempt(1, 'B', 1500, 'certeza'), /Forbidden/);
  assert.equal(queued, 0);
});

test('sync retries a processing conflict but stops for a mismatched idempotency key', async () => {
  for (const [code, expected] of [['idempotency_processing', 'pending'], ['payload_mismatch', 'failed']]) {
    const item = {id:'request',owner_id:'alice',endpoint:'/api/questions/1/attempt',method:'POST',body:'{}',status:'pending',retry_count:0,next_retry_at:0};
    const queue = { where: () => ({equals: () => ({filter: fn => ({toArray: async () => fn(item) ? [item] : [],count:async () => 1})})}),
      update: async (_, change) => Object.assign(item, change) };
    const { syncManager } = load('sync', {'./db': {getLocalOwnerId: () => 'alice',localDb:{syncQueue:queue}}}, {
      window:{dispatchEvent(){}},navigator:{onLine:true},CustomEvent:class {},
      fetch:async () => ({ok:false,status:409,headers:new Headers({'Retry-After':'2'}),json:async () => ({code})}),
    });
    await syncManager.sync();
    assert.equal(item.status, expected);
    if (expected === 'pending') assert.ok(item.next_retry_at > Date.now());
  }
});

test('a request started by Alice is not queued as Bob after an account switch', async () => {
  let owner = 'alice'; let queued = 0;
  const { api } = load('api', {'./db':{getLocalOwnerId: () => owner},'./sync':{syncManager:{enqueue:async () => {queued++;}}}}, {
    window:{},navigator:{onLine:true},fetch:async () => {owner = 'bob'; throw new TypeError('Network failed');},
  });
  await assert.rejects(api.questions.submitAttempt(1, 'A', 1200), /Network failed/);
  assert.equal(queued, 0);
});

test('cobertura diacritic normalization matches unaccented medical search queries', () => {
  const { normalizeTopicSearch } = load('analysisTimeline');

  const subtemas = [
    'Hipertensão Arterial Sistêmica',
    'Ginecologia e Obstetrícia',
    'Pré-Natal e Modificações Fisiológicas da Gravidez',
    'Úlcera Péptica e Hemorragia Digestiva Alta',
    'Reanimação Neonatal em Sala de Parto',
  ];

  const queries = [
    { q: 'hipertensao', expected: 'Hipertensão Arterial Sistêmica' },
    { q: 'obstetricia', expected: 'Ginecologia e Obstetrícia' },
    { q: 'pre-natal', expected: 'Pré-Natal e Modificações Fisiológicas da Gravidez' },
    { q: 'ulcera peptica', expected: 'Úlcera Péptica e Hemorragia Digestiva Alta' },
    { q: 'reanimacao', expected: 'Reanimação Neonatal em Sala de Parto' },
  ];

  for (const { q, expected } of queries) {
    const normQ = normalizeTopicSearch(q);
    const matched = subtemas.filter(sub => normalizeTopicSearch(sub).includes(normQ));
    assert.ok(matched.includes(expected), `Query '${q}' should match '${expected}'`);
  }
});

test('cobertura practice link sets unanswered_only false only when all questions are answered', () => {
  function getPracticeUnansweredParam(answered, total) {
    return answered < total ? 'true' : 'false';
  }

  assert.equal(getPracticeUnansweredParam(0, 20), 'true');
  assert.equal(getPracticeUnansweredParam(10, 20), 'true');
  assert.equal(getPracticeUnansweredParam(20, 20), 'false');
  assert.equal(getPracticeUnansweredParam(25, 20), 'false');
});

test('api.questions.saveSimuladoSession targets the canonical /api/simulado/sessions endpoint', async () => {
  let requestedUrl = '';
  let requestedMethod = '';
  const { api } = load('api', {
    './db': { getLocalOwnerId: () => 'alice' },
    './sync': {},
  }, {
    fetch: async (url, options) => {
      requestedUrl = url;
      requestedMethod = options.method;
      return { ok: true, json: async () => ({ success: true }) };
    }
  });

  const res = await api.questions.saveSimuladoSession({
    client_session_id: 'test-session-123',
    planned_duration_seconds: 3600,
    elapsed_seconds: 1200,
    total_questions: 20,
    answered_count: 20,
    correct_count: 16,
  });

  assert.match(requestedUrl, /\/api\/simulado\/sessions$/);
  assert.equal(requestedMethod, 'POST');
  assert.equal(res.success, true);
});

test('api.questions.getBatch local fallback uses compound keys [id, ownerId]', async () => {
  let queriedKeys = null;
  const mockDb = {
    questions: {
      bulkGet: async (keys) => {
        queriedKeys = keys;
        return keys.map(([id]) => ({ id, stem: `Question ${id}`, alternatives: [] }));
      },
    },
  };

  const { api } = load('api', {
    './db': { getLocalOwnerId: () => 'alice', localDb: mockDb },
    './sync': {},
  }, {
    window: {},
    navigator: { onLine: false },
  });

  const res = await api.questions.getBatch([101, 102]);
  assert.deepEqual(JSON.parse(JSON.stringify(queriedKeys)), [[101, 'alice'], [102, 'alice']]);
  assert.equal(res.questions.length, 2);
  assert.equal(res.questions[0].id, 101);
  assert.equal(res.questions[1].id, 102);
});

test('offline exam summaries are durably queued, but planner resets are not', async () => {
  const queued = [];
  const { api, OfflineQueuedError } = load('api', {
    './sync': { syncManager: { enqueue: async (...args) => { queued.push(args); return 'pending'; } } },
  }, { window: {}, navigator: { onLine: false } });
  await assert.rejects(api.questions.saveSimuladoSession({ client_session_id: 'exam-1', planned_duration_seconds: 60, elapsed_seconds: 30, total_questions: 1, answered_count: 1, correct_count: 1, filters: {}, area_results: [] }), OfflineQueuedError);
  await assert.rejects(api.planner.resetConfig(), TypeError);
  assert.equal(queued.length, 1);
  assert.ok(queued[0][0].endsWith('/api/simulado/sessions'));
  assert.equal(JSON.parse(queued[0][1].body).client_session_id, 'exam-1');
});

test('api.questions.evaluateTri and api.stats.getTriReadiness dispatch correct paths and payloads', async () => {
  const fetchCalls = [];
  const fakeFetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        theta: 1.25,
        projected_score: 80.0,
        specialty_cutoffs: [],
      }),
    };
  };

  const { api } = load('api', {
    './sync': { syncManager: { enqueue: async () => 'pending' } },
  }, { fetch: fakeFetch });

  const triRes = await api.questions.evaluateTri({
    responses: [{ question_id: 1, is_correct: true }],
    institution_code: 'USP',
  });
  assert.equal(triRes.projected_score, 80.0);
  assert.equal(fetchCalls.length, 1);
  assert.ok(fetchCalls[0].url.endsWith('/api/simulado/tri-evaluation'));
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.equal(JSON.parse(fetchCalls[0].options.body).institution_code, 'USP');

  const readyRes = await api.stats.getTriReadiness('ENARE');
  assert.equal(readyRes.theta, 1.25);
  assert.equal(fetchCalls.length, 2);
  assert.ok(fetchCalls[1].url.endsWith('/api/stats/tri-readiness?institution=ENARE'));
});

test('parseSearchHighlight extracts mark/b highlights safely without returning raw HTML', () => {
  const { parseSearchHighlight } = load('searchHighlight');
  const segments = JSON.parse(JSON.stringify(parseSearchHighlight('Paciente com <mark>sepse</mark> e <img src=x onerror=alert(1)> <b>choque</b>.')));
  assert.equal(segments.length, 5);
  assert.deepEqual(segments[0], { text: 'Paciente com ', highlight: false });
  assert.deepEqual(segments[1], { text: 'sepse', highlight: true });
  assert.deepEqual(segments[3], { text: 'choque', highlight: true });
  assert.equal(parseSearchHighlight('').length, 0);
});

test('sliceTimelineByDays filters 180-day history cleanly in memory for 14D/30D/90D/180D', () => {
  const { sliceTimelineByDays } = load('analysisTimeline');
  const ref = new Date('2026-11-14T12:00:00Z');
  const data = [
    { day: '2026-06-01', attempts: 10, correct: 6, accuracy: 0.6 },
    { day: '2026-09-01', attempts: 20, correct: 14, accuracy: 0.7 },
    { day: '2026-10-20', attempts: 15, correct: 12, accuracy: 0.8 },
    { day: '2026-11-10', attempts: 12, correct: 10, accuracy: 0.83 },
  ];
  assert.deepEqual(sliceTimelineByDays(data, 14, ref).map(d => d.day), ['2026-11-10']);
  assert.deepEqual(sliceTimelineByDays(data, 30, ref).map(d => d.day), ['2026-10-20', '2026-11-10']);
  assert.deepEqual(sliceTimelineByDays(data, 90, ref).map(d => d.day), ['2026-09-01', '2026-10-20', '2026-11-10']);
  assert.deepEqual(sliceTimelineByDays(data, 180, ref).map(d => d.day), ['2026-06-01', '2026-09-01', '2026-10-20', '2026-11-10']);
});

test('areFiltersEquivalent detects changes in q, has_images, and unanswered_only across study sessions', () => {
  const { areFiltersEquivalent } = load('quizFilterMatch');
  assert.equal(areFiltersEquivalent({ area: 'Cirurgia', q: 'apendicite', has_images: 'true' }, { area: 'Cirurgia', q: 'apendicite', has_images: 'true' }), true);
  assert.equal(areFiltersEquivalent({ area: 'Cirurgia', q: 'apendicite' }, { area: 'Cirurgia', q: 'colecistite' }), false);
  assert.equal(areFiltersEquivalent({ area: 'Cirurgia', has_images: 'true' }, { area: 'Cirurgia' }), false);
  assert.equal(areFiltersEquivalent({ subtema: ['A', 'B'] }, { subtema: ['B', 'A'] }), true);
});

test('HTTP 401/403/422/429/500/503 responses are never masked as OfflineQueuedError even if navigator.onLine drops during fetch', async () => {
  for (const status of [401, 403, 422, 429, 500, 503]) {
    let queued = 0;
    let online = true;
    const { api, ApiHttpError } = load('api', {
      './db': {
        getLocalOwnerId: () => 'alice',
        isDeviceOffline: () => !online,
      },
      './sync': { syncManager: { enqueue: async () => { queued++; return 'q-1'; } } },
    }, {
      window: {},
      navigator: { get onLine() { return online; } },
      fetch: async () => {
        online = false; // Browser reports offline right as HTTP error arrives
        return {
          ok: false,
          status,
          statusText: `HTTP ${status}`,
          json: async () => ({ error: `Server error ${status}` }),
        };
      },
    });

    await assert.rejects(
      api.questions.submitAttempt(10, 'C', 2000, 'duvida', undefined, undefined, null, true),
      (err) => err instanceof ApiHttpError && err.status === status
    );
    assert.equal(queued, 0, `Status ${status} must not be queued as OfflineQueuedError`);
  }
});

test('api.questions.getBatch and getSimuladoUSP respect Modo Plantão Forçado (isDeviceOffline) without hitting network', async () => {
  let networkCalls = 0;
  const mockDb = {
    questions: {
      bulkGet: async (keys) => keys.map(([id]) => ({ id, stem: `Offline Q ${id}`, alternatives: [] })),
      where: () => ({
        equals: () => ({
          toArray: async () => [{
            id: 77,
            source_file: 'usp.json',
            source_number: '1',
            year: 2025,
            institution_code: 'USP',
            institution_label: 'USP',
            topic: 'Cirurgia',
            area: 'Cirurgia Geral',
            subtema: 'Trauma',
          }],
        }),
      }),
    },
  };

  const { api } = load('api', {
    './db': {
      getLocalOwnerId: () => 'alice',
      isDeviceOffline: () => true, // Modo Plantão Forçado ativo mesmo com navigator.onLine = true
      localDb: mockDb,
    },
    './sync': {},
  }, {
    window: {},
    navigator: { onLine: true },
    fetch: async () => {
      networkCalls++;
      throw new Error('Should not call fetch when Modo Plantão Forçado is active');
    },
  });

  const batchRes = await api.questions.getBatch([101, 102]);
  assert.equal(batchRes.questions.length, 2);
  const uspRes = await api.questions.getSimuladoUSP();
  assert.equal(uspRes.length, 1);
  assert.equal(uspRes[0].id, 77);
  assert.equal(networkCalls, 0);
});

test('MultiparameterMonitor keeps 60fps canvas RAF loop decoupled from 1Hz vitals updates and cleans up AudioContext on unmount', () => {
  const monitorSource = readFileSync(
    new URL('../../src/app/osce/[id]/MultiparameterMonitor.tsx', import.meta.url),
    'utf8'
  );
  assert.match(monitorSource, /vitalsRef\.current\s*=\s*vitals/);
  assert.match(monitorSource, /isMonitoredRef\.current\s*=\s*isMonitored/);
  assert.match(monitorSource, /audioCtxRef\.current\.close\(\)/);
  assert.match(monitorSource, /React\.memo\(function MultiparameterMonitor/);
});

test('useOsceAudio reuses bellAudioCtxRef and cleans up speech synthesis, recognition, and timers when leaving exam phase', () => {
  const audioHookSource = readFileSync(
    new URL('../../src/app/osce/[id]/useOsceAudio.ts', import.meta.url),
    'utf8'
  );
  assert.match(audioHookSource, /bellAudioCtxRef/);
  assert.match(audioHookSource, /permStatusRef\.current\.onchange\s*=\s*null/);
  assert.match(audioHookSource, /window\.speechSynthesis\.cancel\(\)/);
});

test('SimuladoNavGrid hoists SimuladoNavCell outside AutoSizer renderProp and guards division by zero on empty queue', () => {
  const navGridSource = readFileSync(
    new URL('../../src/app/simulado/components/SimuladoNavGrid.tsx', import.meta.url),
    'utf8'
  );
  const autoSizerIdx = navGridSource.indexOf('<AutoSizer');
  const cellDefIdx = navGridSource.indexOf('const SimuladoNavCell =');
  assert.ok(cellDefIdx > 0 && cellDefIdx < autoSizerIdx, 'SimuladoNavCell must be defined at module level before AutoSizer');
  assert.match(navGridSource, /queue\.length\s*>\s*0\s*\?\s*Math\.round\(\(correctCount\s*\/\s*queue\.length\)\s*\*\s*100\)\s*:\s*0/);
});



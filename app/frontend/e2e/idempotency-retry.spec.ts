import { test, expect, Page } from '@playwright/test';

const META = {
  total_questions: 2,
  answered_questions: 0,
  institutions: [{ institution_code: 'USP-SP', n: 2 }],
  years: [{ year: 2026, n: 2 }],
  areas: [{ area: 'Clínica Médica', n: 2 }],
  subtemas: [{ subtema: 'HAS', n: 2 }],
  sources: [],
  specialties: [],
};

const ESTUDAR_QUESTIONS: Record<number, {
  id: number;
  stem: string;
  institution_code: string;
  institution_label: string;
  year: number;
  area: string;
  subtema: string;
  topic: string;
  correct_letter: string;
  alternatives: Array<{ letter: string; text: string }>;
}> = {
  1: {
    id: 1,
    stem: 'Qual a conduta inicial padrão para hipertensão estágio 1 sem comorbidades?',
    institution_code: 'USP-SP',
    institution_label: 'USP-SP',
    year: 2026,
    area: 'Clínica Médica',
    subtema: 'HAS',
    topic: 'HAS',
    correct_letter: 'B',
    alternatives: [
      { letter: 'A', text: 'Internação em UTI imediata' },
      { letter: 'B', text: 'Mudança de estilo de vida e avaliação de risco cardiovascular' },
    ],
  },
  2: {
    id: 2,
    stem: 'Qual o alvo pressórico em paciente diabético de alto risco?',
    institution_code: 'USP-SP',
    institution_label: 'USP-SP',
    year: 2026,
    area: 'Clínica Médica',
    subtema: 'HAS',
    topic: 'HAS',
    correct_letter: 'A',
    alternatives: [
      { letter: 'A', text: 'Menor que 130 por 80 mmHg' },
      { letter: 'B', text: 'Menor que 160 por 100 mmHg' },
    ],
  },
};

const SIMULADO_QUESTIONS = [
  { id: 301, institution_code: 'USP-SP', year: 2026, area: 'Clínica Médica', subtema: 'Cardiologia', topic: 'Cardiologia' },
  { id: 302, institution_code: 'USP-SP', year: 2026, area: 'Cirurgia', subtema: 'Trauma', topic: 'Trauma' },
];

const SIMULADO_DETAILS = {
  questions: [
    {
      id: 301,
      stem: 'Paciente com dor torácica típica em aperto. Qual o exame prioritário?',
      institution_code: 'USP-SP',
      institution_label: 'USP-SP',
      year: 2026,
      area: 'Clínica Médica',
      subtema: 'Cardiologia',
      topic: 'Cardiologia',
      correct_letter: 'A',
      alternatives: [
        { letter: 'A', text: 'ECG em até 10 minutos' },
        { letter: 'B', text: 'Alta com analgésico oral' },
      ],
    },
    {
      id: 302,
      stem: 'Trauma torácico com hipotensão e murmúrio vesicular abolido à esquerda.',
      institution_code: 'USP-SP',
      institution_label: 'USP-SP',
      year: 2026,
      area: 'Cirurgia',
      subtema: 'Trauma',
      topic: 'Trauma',
      correct_letter: 'B',
      alternatives: [
        { letter: 'A', text: 'Observação ambulatorial' },
        { letter: 'B', text: 'Descompressão torácica imediata' },
      ],
    },
  ],
};

interface RecordedRequest {
  key: string | null;
  rawBody: string;
}

async function mockEstudarIdempotentServer(page: Page) {
  const idempotencyStore = new Map<string, { body: string; response: unknown }>();
  const requests: RecordedRequest[] = [];
  let writes = 0;

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path.endsWith('/api/meta')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(META) });
    }

    const attemptMatch = path.match(/\/api\/questions\/(\d+)\/attempt$/);
    if (attemptMatch) {
      const qid = Number(attemptMatch[1]);
      const key = route.request().headers()['x-idempotency-key'] ?? null;
      const rawBody = route.request().postData() ?? '';
      requests.push({ key, rawBody });

      if (key && idempotencyStore.has(key)) {
        const stored = idempotencyStore.get(key)!;
        if (stored.body !== rawBody) {
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Idempotency conflict', code: 'idempotency_conflict' }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(stored.response),
        });
      }

      const parsed = JSON.parse(rawBody || '{}') as { selected_letter?: string };
      const q = ESTUDAR_QUESTIONS[qid];
      const responsePayload = {
        is_correct: parsed.selected_letter === q.correct_letter,
        correct_letter: q.correct_letter,
        explanation: 'Comentário oficial.',
        next_review_date: null,
        attempt_id: 500 + writes + 1,
      };
      writes++;
      if (key) {
        idempotencyStore.set(key, { body: rawBody, response: responsePayload });
      }
      // 1ª requisição com esta chave: gravou no servidor, mas cliente recebe 502.
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Bad Gateway' }),
      });
    }

    const detailMatch = path.match(/\/api\/questions\/(\d+)$/);
    if (detailMatch) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ESTUDAR_QUESTIONS[Number(detailMatch[1])]),
      });
    }

    if (path.endsWith('/api/questions')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          [1, 2].map((id) => ({
            id,
            institution_code: 'USP-SP',
            year: 2026,
            area: 'Clínica Médica',
            subtema: 'HAS',
            topic: 'HAS',
          }))
        ),
      });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return {
    requests,
    getWrites: () => writes,
  };
}

test.describe('Bloco C — Idempotência ponta a ponta e retry seguro', () => {
  test.beforeEach(async ({ context, page }) => {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100';
    await context.addCookies([{ name: 'medquest_demo', value: '1', url: baseURL }]);
    await page.addInitScript(() => localStorage.setItem('medquest_onboarding_v1', 'done'));
  });

  test('1. /estudar: 502 seguido de Tentar de novo reutiliza mesma X-Idempotency-Key e corpo (gravações == 1)', async ({ page }) => {
    const server = await mockEstudarIdempotentServer(page);

    await page.goto('/estudar?area=Cl%C3%ADnica+M%C3%A9dica', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Qual a conduta inicial padrão')).toBeVisible();

    await page.getByRole('button', { name: /Mudança de estilo de vida/ }).click();
    await page.getByRole('button', { name: /Confirmar Resposta/ }).click();

    const retryBtn = page.getByRole('button', { name: /Tentar de novo/i });
    await expect(retryBtn).toBeVisible({ timeout: 5000 });
    await retryBtn.click();

    await expect(page.getByText('Resposta Correta', { exact: true })).toBeVisible({ timeout: 5000 });

    expect(server.requests).toHaveLength(2);
    expect(server.requests[0].key).toBeTruthy();
    expect(server.requests[1].key).toBe(server.requests[0].key);
    expect(server.requests[1].rawBody).toBe(server.requests[0].rawBody);
    expect(server.getWrites()).toBe(1);
  });

  test('2. /estudar: reload após 502 retoma pendente com mesma chave e corpo (gravações == 1)', async ({ page }) => {
    const server = await mockEstudarIdempotentServer(page);

    await page.goto('/estudar?area=Cl%C3%ADnica+M%C3%A9dica', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Qual a conduta inicial padrão')).toBeVisible();

    await page.getByRole('button', { name: /Mudança de estilo de vida/ }).click();
    await page.getByRole('button', { name: /Confirmar Resposta/ }).click();

    await expect(page.getByRole('button', { name: /Tentar de novo/i })).toBeVisible({ timeout: 5000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Qual a conduta inicial padrão')).toBeVisible({ timeout: 10000 });

    const retryBtn = page.getByRole('button', { name: /Tentar de novo/i });
    await expect(retryBtn).toBeVisible({ timeout: 5000 });
    await retryBtn.click();

    await expect(page.getByText('Resposta Correta', { exact: true })).toBeVisible({ timeout: 5000 });

    expect(server.requests).toHaveLength(2);
    expect(server.requests[0].key).toBeTruthy();
    expect(server.requests[1].key).toBe(server.requests[0].key);
    expect(server.requests[1].rawBody).toBe(server.requests[0].rawBody);
    expect(server.getWrites()).toBe(1);
  });

  test('3. /estudar: após 502, clicar em outra alternativa não muda aria-pressed', async ({ page }) => {
    await mockEstudarIdempotentServer(page);

    await page.goto('/estudar?area=Cl%C3%ADnica+M%C3%A9dica', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Qual a conduta inicial padrão')).toBeVisible();

    const altA = page.getByRole('button', { name: /Internação em UTI imediata/ });
    const altB = page.getByRole('button', { name: /Mudança de estilo de vida/ });

    await altB.click();
    await expect(altB).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /Confirmar Resposta/ }).click();

    await expect(page.getByRole('button', { name: /Tentar de novo/i })).toBeVisible({ timeout: 5000 });

    await altA.click();
    await expect(altB).toHaveAttribute('aria-pressed', 'true');
    await expect(altA).toHaveAttribute('aria-pressed', 'false');
  });

  test('4. Simulado: 502 no lote seguido de nova finalização reutiliza mesma chave (gravações do lote == 1)', async ({ page }) => {
    const batchStore = new Map<string, { body: string; response: unknown }>();
    const batchRequests: RecordedRequest[] = [];
    let batchWrites = 0;

    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;

      if (path.endsWith('/api/meta')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(META) });
      }
      if (path.includes('/simulado/custom') || path.endsWith('/api/questions')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIMULADO_QUESTIONS) });
      }
      if (path.endsWith('/api/questions/batch')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIMULADO_DETAILS) });
      }
      if (path.endsWith('/api/questions/301')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIMULADO_DETAILS.questions[0]) });
      }
      if (path.endsWith('/api/questions/302')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIMULADO_DETAILS.questions[1]) });
      }
      if (path.endsWith('/api/attempt/batch')) {
        const key = route.request().headers()['x-idempotency-key'] ?? null;
        const rawBody = route.request().postData() ?? '';
        batchRequests.push({ key, rawBody });

        if (key && batchStore.has(key)) {
          const stored = batchStore.get(key)!;
          if (stored.body !== rawBody) {
            return route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Idempotency conflict', code: 'idempotency_conflict' }),
            });
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(stored.response),
          });
        }

        const responsePayload = {
          results: [
            { question_id: 301, is_correct: true, correct_letter: 'A', explanation: 'ECG precoce.', next_review_date: '2026-12-01T00:00:00Z' },
            { question_id: 302, is_correct: true, correct_letter: 'B', explanation: 'Descompressão.', next_review_date: '2026-12-01T00:00:00Z' },
          ],
        };
        batchWrites++;
        if (key) {
          batchStore.set(key, { body: rawBody, response: responsePayload });
        }
        return route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Bad Gateway' }),
        });
      }

      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/simulado?area=Cl%C3%ADnica+M%C3%A9dica', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Iniciar Agora' }).click();

    await expect(page.getByText('Paciente com dor torácica típica')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /ECG em até 10 minutos/ }).click();
    await page.getByRole('button', { name: /Próxima/ }).last().click();
    await expect(page.getByText('Trauma torácico com hipotensão')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Descompressão torácica imediata/ }).click();

    // 1ª finalização -> 502
    await page.getByRole('button', { name: 'Finalizar Simulado' }).click();
    await page.getByRole('button', { name: 'Entregar Prova' }).click();
    await expect(page.getByRole('button', { name: 'Finalizar Simulado' })).toBeVisible({ timeout: 5000 });

    // 2ª finalização -> deve reutilizar a mesma X-Idempotency-Key e o mesmo payload
    await page.getByRole('button', { name: 'Finalizar Simulado' }).click();
    await page.getByRole('button', { name: 'Entregar Prova' }).click();

    await expect(page.getByText('Nota Final')).toBeVisible({ timeout: 10000 });
    expect(batchRequests).toHaveLength(2);
    expect(batchRequests[0].key).toBeTruthy();
    expect(batchRequests[1].key).toBe(batchRequests[0].key);
    expect(batchRequests[1].rawBody).toBe(batchRequests[0].rawBody);
    expect(batchWrites).toBe(1);
  });

  test('5. Simulado prática: questão na fila offline exibe AWAITING_PRACTICE_SYNC, não entra no lote e não duplica gravação', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('medquest_simulado_mode', 'practice');
    });

    let blockQ301FirstAttempt = true;
    const recordedWritesByQid = new Map<number, number>();
    const seenKeys = new Set<string>();
    const batchSubmittedQids: number[] = [];

    const recordWrite = (qid: number, key: string | null) => {
      if (key && seenKeys.has(key)) return;
      if (key) seenKeys.add(key);
      recordedWritesByQid.set(qid, (recordedWritesByQid.get(qid) ?? 0) + 1);
    };

    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;

      if (path.endsWith('/api/meta')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(META) });
      }
      if (path.includes('/simulado/custom') || path.endsWith('/api/questions')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIMULADO_QUESTIONS) });
      }
      if (path.endsWith('/api/questions/batch')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIMULADO_DETAILS) });
      }
      if (path.endsWith('/api/questions/301')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIMULADO_DETAILS.questions[0]) });
      }
      if (path.endsWith('/api/questions/302')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIMULADO_DETAILS.questions[1]) });
      }

      const attemptMatch = path.match(/\/api\/questions\/(\d+)\/attempt$/);
      if (attemptMatch) {
        const qid = Number(attemptMatch[1]);
        if (qid === 301 && blockQ301FirstAttempt) {
          return route.abort('internetdisconnected');
        }
        const key = route.request().headers()['x-idempotency-key'] ?? null;
        const body = route.request().postDataJSON() as { selected_letter?: string };
        recordWrite(qid, key);
        const q = SIMULADO_DETAILS.questions.find((item) => item.id === qid)!;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            is_correct: body.selected_letter === q.correct_letter,
            correct_letter: q.correct_letter,
            explanation: `Explicação da questão ${qid}.`,
            next_review_date: '2026-12-01T00:00:00Z',
            attempt_id: 900 + qid,
          }),
        });
      }

      if (path.endsWith('/api/attempt/batch')) {
        const key = route.request().headers()['x-idempotency-key'] ?? null;
        const payload = route.request().postDataJSON() as { attempts: Array<{ question_id: number; selected_letter: string }> };
        const results = (payload.attempts || []).map((a) => {
          batchSubmittedQids.push(a.question_id);
          recordWrite(a.question_id, key ? `${key}:${a.question_id}` : null);
          const q = SIMULADO_DETAILS.questions.find((item) => item.id === a.question_id)!;
          return {
            question_id: a.question_id,
            is_correct: a.selected_letter === q.correct_letter,
            correct_letter: q.correct_letter,
            explanation: `Explicação em lote ${a.question_id}.`,
            next_review_date: '2026-12-01T00:00:00Z',
          };
        });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ results }),
        });
      }

      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/simulado?area=Cl%C3%ADnica+M%C3%A9dica', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Iniciar Agora' }).click();

    // Q301 cai na fila offline
    await expect(page.getByText('Paciente com dor torácica típica')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /ECG em até 10 minutos/ }).click();

    // Aguarda enfileiramento no IndexedDB
    await page.waitForTimeout(400);

    // Q302 responde normalmente em modo prática
    await page.getByRole('button', { name: /Próxima/ }).last().click();
    await expect(page.getByText('Trauma torácico com hipotensão')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Descompressão torácica imediata/ }).click();
    await expect(page.getByText('Comentário do Professor')).toBeVisible({ timeout: 5000 });

    // Finalizar -> deve entrar em AWAITING_PRACTICE_SYNC
    await page.getByRole('button', { name: 'Finalizar Simulado' }).click();
    await page.getByRole('button', { name: 'Entregar Prova' }).click();

    await expect(page.getByText(/Aguardando sincronizar 1 resposta.*modo treino/i)).toBeVisible({ timeout: 5000 });
    expect(batchSubmittedQids).not.toContain(301);

    // Liberar a rota e sincronizar
    blockQ301FirstAttempt = false;
    await page.getByRole('button', { name: /Sincronizar agora/i }).click();

    await expect(page.getByText('Nota Final')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('100% de Acerto')).toBeVisible();

    expect(batchSubmittedQids).not.toContain(301);
    const totalWrites = Array.from(recordedWritesByQid.values()).reduce((sum, n) => sum + n, 0);
    expect(totalWrites).toBe(2);
    expect(recordedWritesByQid.get(301)).toBe(1);
    expect(recordedWritesByQid.get(302)).toBe(1);
  });
});

import { test, expect, Page } from '@playwright/test';

// Regressões do Bloco B da auditoria (P1-01 e P2-16):
// - navegar durante um envio não pode travar a sessão nem permitir um 2º envio;
// - Enter numa alternativa focada nunca pode confirmar outra letra.

const META = {
  total_questions: 2,
  answered_questions: 0,
  institutions: [{ institution_code: "USP", n: 2 }],
  years: [{ year: 2025, n: 2 }],
  areas: [{ area: "Clínica Médica", n: 2 }],
  subtemas: [{ subtema: "HAS", n: 2 }],
  sources: [],
  specialties: [],
};

const QUESTIONS: Record<number, object> = {
  1: {
    id: 1,
    stem: "Primeira questão: tratamento inicial da hipertensão?",
    institution_code: "USP", institution_label: "USP", year: 2025,
    area: "Clínica Médica", subtema: "HAS", topic: "HAS", correct_letter: "B",
    alternatives: [
      { letter: "A", text: "Internação imediata para todos" },
      { letter: "B", text: "Mudança de estilo de vida e tratamento individualizado" },
    ],
  },
  2: {
    id: 2,
    stem: "Segunda questão: alvo pressórico em diabéticos?",
    institution_code: "USP", institution_label: "USP", year: 2025,
    area: "Clínica Médica", subtema: "HAS", topic: "HAS", correct_letter: "A",
    alternatives: [
      { letter: "A", text: "Menor que 130 por 80 mmHg" },
      { letter: "B", text: "Menor que 160 por 100 mmHg" },
    ],
  },
};

type AttemptLog = { qid: number; letter: string | null };

async function mockApi(page: Page, opts: { attemptDelayMs?: number } = {}) {
  const attempts: AttemptLog[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/meta')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(META) });
    }
    const attemptMatch = path.match(/\/api\/questions\/(\d+)\/attempt$/);
    if (attemptMatch) {
      const qid = Number(attemptMatch[1]);
      const body = route.request().postDataJSON() as { selected_letter?: string };
      attempts.push({ qid, letter: body?.selected_letter ?? null });
      if (opts.attemptDelayMs) await new Promise(r => setTimeout(r, opts.attemptDelayMs));
      const q = QUESTIONS[qid] as { correct_letter: string };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          is_correct: body?.selected_letter === q.correct_letter,
          correct_letter: q.correct_letter,
          explanation: 'Comentário.',
          next_review_date: null,
          attempt_id: 100 + qid,
        }),
      });
    }
    const detailMatch = path.match(/\/api\/questions\/(\d+)$/);
    if (detailMatch) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QUESTIONS[Number(detailMatch[1])]) });
    }
    if (path.endsWith('/api/questions')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([1, 2].map(id => ({ id, institution_code: 'USP', year: 2025, area: 'Clínica Médica', subtema: 'HAS', topic: 'HAS' }))),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return attempts;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('medquest_onboarding_v1', 'done'));
});

test('navegar durante o envio não trava a próxima questão nem permite 2º envio', async ({ page }) => {
  const attempts = await mockApi(page, { attemptDelayMs: 2000 });

  await page.goto('/estudar?area=Cl%C3%ADnica+M%C3%A9dica', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Primeira questão')).toBeVisible();

  await page.getByRole('button', { name: /Mudança de estilo de vida/ }).click();
  await page.getByRole('button', { name: 'Confirmar Resposta' }).click();

  // Navega enquanto o envio da questão 1 ainda está em voo.
  await page.getByRole('button', { name: 'Próxima Questão' }).click();
  await expect(page.getByText('Segunda questão')).toBeVisible();

  // A questão 2 precisa continuar respondível.
  const q2Alt = page.getByRole('button', { name: /Menor que 130 por 80/ });
  await q2Alt.click();
  await expect(q2Alt).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Confirmar Resposta' })).toBeEnabled();

  // Volta para a questão 1 ainda em voo: não pode disparar um novo envio.
  await page.getByRole('button', { name: 'Questão Anterior' }).click();
  await expect(page.getByText('Primeira questão')).toBeVisible();
  await page.keyboard.press('Enter');

  // Ao concluir, o resultado chega na questão de origem.
  await expect(page.getByText('Resposta Correta', { exact: true })).toBeVisible({ timeout: 5000 });
  expect(attempts.filter(a => a.qid === 1)).toHaveLength(1);
});

test('Enter numa alternativa focada seleciona essa letra e nunca confirma a anterior', async ({ page }) => {
  const attempts = await mockApi(page);

  await page.goto('/estudar?area=Cl%C3%ADnica+M%C3%A9dica', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Primeira questão')).toBeVisible();

  const altA = page.getByRole('button', { name: /Internação imediata/ });
  const altB = page.getByRole('button', { name: /Mudança de estilo de vida/ });

  await altA.click();
  await expect(altA).toHaveAttribute('aria-pressed', 'true');

  // Foca B e aperta Enter: deve apenas selecionar B, sem enviar A.
  await altB.focus();
  await page.keyboard.press('Enter');
  await expect(altB).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300);
  expect(attempts).toHaveLength(0);

  // Enter de novo na alternativa já selecionada confirma B.
  await page.keyboard.press('Enter');
  await expect(page.getByText('Resposta Correta', { exact: true })).toBeVisible();
  expect(attempts).toEqual([{ qid: 1, letter: 'B' }]);
});

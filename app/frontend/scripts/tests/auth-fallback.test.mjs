import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function loadAuthServer({ env = {}, cwd }) {
  const source = readFileSync(new URL('../../src/lib/auth-server.ts', import.meta.url), 'utf8');
  const exports = {};
  const cjsModule = { exports };
  const fakeProcess = {
    env: { ...env },
    cwd: () => cwd,
  };
  const deps = {
    'node:fs': { existsSync: (awaitPath) => {
      try {
        readFileSync(awaitPath);
        return true;
      } catch {
        return false;
      }
    } },
    'node:path': { join },
    '@clerk/nextjs/server': {
      auth: async () => ({ userId: 'clerk_user_1', getToken: async () => 'tok_1' }),
      currentUser: async () => ({ id: 'clerk_user_1', firstName: 'Dr.' }),
    },
  };
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  runInNewContext(transpiled, {
    exports,
    module: cjsModule,
    process: fakeProcess,
    require: (id) => {
      assert.ok(id in deps, `Dependência não mapeada: ${id}`);
      return deps[id];
    },
  });

  return cjsModule.exports;
}

test('isClerkServerEnabled: desativa em dev sem chaves e sem keyless.json (ex.: AI Studio)', async () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'mq-no-clerk-'));
  try {
    const mod = loadAuthServer({ env: { NODE_ENV: 'development' }, cwd: emptyDir });
    assert.equal(mod.isClerkServerEnabled(), false);
    const authState = await mod.getServerAuthState();
    assert.equal(authState.userId, null);
    assert.equal(await authState.getToken(), null);
    assert.equal(await mod.getServerCurrentUser(), null);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('isClerkServerEnabled: ativa em dev quando chaves explícitas estão definidas', async () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'mq-keys-'));
  try {
    const mod = loadAuthServer({
      env: {
        NODE_ENV: 'development',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_123',
        CLERK_SECRET_KEY: 'sk_test_123',
      },
      cwd: emptyDir,
    });
    assert.equal(mod.isClerkServerEnabled(), true);
    const authState = await mod.getServerAuthState();
    assert.equal(authState.userId, 'clerk_user_1');
    assert.equal(await authState.getToken(), 'tok_1');
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('isClerkServerEnabled: ativa em dev quando .clerk/.tmp/keyless.json existe', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'mq-keyless-'));
  try {
    mkdirSync(join(tmpDir, '.clerk', '.tmp'), { recursive: true });
    writeFileSync(join(tmpDir, '.clerk', '.tmp', 'keyless.json'), '{}');
    const mod = loadAuthServer({ env: { NODE_ENV: 'development' }, cwd: tmpDir });
    assert.equal(mod.isClerkServerEnabled(), true);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('isClerkServerEnabled: sempre obrigatório em production mesmo sem chaves', () => {
  const emptyDir = mkdtempSync(join(tmpdir(), 'mq-prod-'));
  try {
    const mod = loadAuthServer({
      env: { NODE_ENV: 'production', MEDQUEST_PREVIEW_NO_CLERK: '1' },
      cwd: emptyDir,
    });
    assert.equal(mod.isClerkServerEnabled(), true);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('next.config.ts libera domínios de preview do Google AI Studio em allowedDevOrigins', () => {
  const configSource = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8');
  assert.match(configSource, /allowedDevOrigins:\s*\[[^\]]*['"]\*\*\.run\.app['"]/);
  assert.match(configSource, /allowedDevOrigins:\s*\[[^\]]*['"]\*\*\.aistudio\.google\.com['"]/);
});

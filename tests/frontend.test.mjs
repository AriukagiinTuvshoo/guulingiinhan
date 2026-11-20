import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function verify(env) {
  const clean = { ...process.env };
  delete clean.NEXT_PUBLIC_API_BASE_URL;
  delete clean.VERCEL;
  return spawnSync(process.execPath, ['scripts/verify-production-env.mjs'], {
    env: { ...clean, ...env }, encoding: 'utf8',
  });
}

test('production requires API base', () => {
  assert.equal(verify({ VERCEL: '1' }).status, 1);
});

test('valid absolute and relative API bases pass', () => {
  for (const base of ['https://api.example.test/api/v1', '/api/v1']) {
    assert.equal(verify({ VERCEL: '1', NEXT_PUBLIC_API_BASE_URL: base }).status, 0);
  }
});

test('invalid API base is rejected', () => {
  assert.equal(verify({ NEXT_PUBLIC_API_BASE_URL: 'javascript:bad' }).status, 1);
});

/** Read-only/public P12.5 staging checks. Never reads browser cookies or private data. */
import fs from 'node:fs/promises';

const frontend = process.env.QA_FRONTEND_ORIGIN || 'https://guulingiinhan-staging.tuvshoo0331.workers.dev';
const backend = process.env.QA_API_ORIGIN || 'https://guulingiinhan-backend-staging.tuvshoo0331.workers.dev';
for (const origin of [frontend, backend]) {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
    throw new Error('QA origins must be exact HTTPS origins without credentials, paths or tokens.');
  }
}
const id = '00000000-0000-4000-8000-000000000000';
const protectedPaths = [
  ['people', `/families/${id}/people`],
  ['tree', `/families/${id}/tree`],
  ['profile', `/families/${id}/persons/${id}`],
  ['timeline', `/families/${id}/persons/${id}/timeline`],
  ['relationship', `/families/${id}/relationship-path?first=${id}&second=${id}`],
  ['story', `/families/${id}/stories/${id}`],
  ['memory', `/families/${id}/memories/${id}`],
  ['archive', `/families/${id}/archives/${id}`],
  ['content links', `/families/${id}/content-links/story/${id}`],
  ['media', `/families/${id}/photos/${id}/content?variant=original`],
  ['admin', '/admin/shared-lineage/candidates'],
];

async function check(label, path, expected, options = {}, assertions = () => ({})) {
  const started = performance.now();
  try {
    const r = await fetch(backend + path, { ...options, signal: AbortSignal.timeout(30000) });
    const body = await r.text();
    const flags = assertions(r, body);
    return { label, status: r.status, expected, pass: expected.includes(r.status) && !Object.values(flags).includes(false),
      ms: Math.round(performance.now() - started), bytes: Buffer.byteLength(body),
      cache_control: r.headers.get('cache-control'), ...flags };
  } catch (error) {
    return { label, pass: false, error_type: error.name };
  }
}

const results = await Promise.all([
  check('liveness', '/health', [200]),
  check('database readiness', '/health/ready', [200]),
  ...protectedPaths.map(([label, path]) => check(`anonymous ${label}`, '/api/v1' + path, [401, 403], {},
    (r, body) => ({ safe_error: !/traceback|sqlalchemy|password_hash|token_hash|object_key/i.test(body),
      cache_private: r.headers.get('cache-control')?.includes('no-store') === true }))),
  check('allowed CORS preflight', '/api/v1/auth/login', [200, 204], { method: 'OPTIONS', headers: {
    Origin: frontend, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
  } }, r => ({ exact_origin: r.headers.get('access-control-allow-origin') === frontend,
    credentials: r.headers.get('access-control-allow-credentials') === 'true' })),
  check('foreign CORS preflight', '/api/v1/auth/login', [400, 403], { method: 'OPTIONS', headers: {
    Origin: 'https://unauthorized.invalid', 'Access-Control-Request-Method': 'POST',
  } }, r => ({ no_foreign_allow: r.headers.get('access-control-allow-origin') !== 'https://unauthorized.invalid' })),
  check('foreign mutation Origin', '/api/v1/auth/login', [403], { method: 'POST', headers: {
    Origin: 'https://unauthorized.invalid', 'Content-Type': 'application/json',
  }, body: JSON.stringify({ email: 'not-an-email', password: '' }) }),
  check('invalid email/password input', '/api/v1/auth/login', [422], { method: 'POST', headers: {
    Origin: frontend, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ email: 'not-an-email', password: '' }) }, (_, body) => ({ input_not_echoed: !body.includes('not-an-email') })),
  check('invalid registration input', '/api/v1/auth/register', [422], { method: 'POST', headers: {
    Origin: frontend, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ email: 'not-an-email', password: '' }) }),
]);
try {
  const response = await fetch(frontend + '/login', { signal: AbortSignal.timeout(30000) });
  const headers = response.headers;
  const flags = {
    frame_ancestors: headers.get('content-security-policy')?.includes("frame-ancestors 'none'") === true,
    no_objects: headers.get('content-security-policy')?.includes("object-src 'none'") === true,
    frame_deny: headers.get('x-frame-options') === 'DENY',
    nosniff: headers.get('x-content-type-options') === 'nosniff',
    referrer_policy: headers.get('referrer-policy') === 'strict-origin-when-cross-origin',
    https_policy: headers.get('strict-transport-security')?.includes('max-age=31536000') === true,
  };
  results.push({ label: 'frontend HTTP protection headers', status: response.status, expected: [200],
    pass: response.status === 200 && Object.values(flags).every(Boolean), ...flags });
} catch (error) {
  results.push({ label: 'frontend HTTP protection headers', pass: false, error_type: error.name });
}
const evidence = { checked_at: new Date().toISOString(), frontend_origin: frontend, api_origin: backend,
  scope: 'Live staging public/anonymous HTTP only. No authenticated cookies, account creation, provider deliveries or private records.',
  latency_note: 'Single observations include network latency; these are not authenticated product medians or p95.', results };
await fs.writeFile('docs/STAGING_GATE.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
if (results.some(r => !r.pass)) process.exitCode = 1;

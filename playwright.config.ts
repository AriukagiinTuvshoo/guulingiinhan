import { defineConfig, devices } from '@playwright/test';

// Never let the test server fall back to a developer or production database.
// The runner must create and migrate a disposable, dedicated SQLite file.
if (!/^sqlite:\/\/\/\/tmp\/guulingiinhan-e2e-[a-zA-Z0-9_-]+\.sqlite$/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('DATABASE_URL must name a disposable /tmp/guulingiinhan-e2e-*.sqlite database');
}

// Opt-in: `E2E_SERVER=production` serves the already built bundle with `next start`
// instead of the dev compiler, so the browser stage does not also pay per-route
// compilation on memory-limited runners. The build must then inline
// NEXT_PUBLIC_API_BASE_URL (see lib/api.ts); CI default behaviour is unchanged.
const productionServer = process.env.E2E_SERVER === 'production';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Never retry in CI: a flake that passes on the second attempt would turn a real
  // failure into a green release gate. Use `--retries=N` explicitly when triaging.
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:3100', ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'cd backend && uv run --locked uvicorn app.main:app --host 127.0.0.1 --port 8100',
      url: 'http://localhost:8100/health',
      reuseExistingServer: false,
      env: { APP_ENV: 'test', CORS_ORIGINS: 'http://localhost:3100' },
      timeout: 120_000,
    },
    productionServer
      ? {
          command: 'npm run start -- --port 3100',
          url: 'http://localhost:3100/login',
          // Stateless static server; reusing one that is already up is safe and
          // avoids launching a duplicate. The backend below is never reused.
          reuseExistingServer: true,
          timeout: 120_000,
        }
      : {
          command: 'npm run dev -- --port 3100',
          url: 'http://localhost:3100/login',
          reuseExistingServer: false,
          env: { NEXT_PUBLIC_API_BASE_URL: 'http://localhost:8100/api/v1' },
          timeout: 120_000,
        },
  ],
});

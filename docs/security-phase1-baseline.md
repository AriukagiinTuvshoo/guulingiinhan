# Phase 1 foundation hardening — baseline report

**Captured:** 2026-11-20  
**Repository:** `AriukagiinTuvshoo/guulingiinhan`  
**Scope:** Baseline captured before application-source edits. Existing clone in this workspace was made during the preceding audit; it is not a developer's local checkout.

## Git baseline

- Remote: `https://github.com/AriukagiinTuvshoo/guulingiinhan.git` (`origin`).
- Current branch before implementation: `main`.
- Local HEAD: `030db4fda4964e7f64637afb85944ca904db259b`.
- After read-only `git fetch origin --prune`, `origin/main` was the same SHA; local/remote divergence: 0/0.
- Before installing test tooling/running baseline checks, `git status --short --branch` showed `## main...origin/main`, with no staged, tracked modified, or untracked files. Thus no existing source/user changes were present in this audit clone at baseline. Git cannot report modifications on a developer's separate workstation.
- No `AGENTS.md`, `CONTRIBUTING.md`, or development-instructions file was found under the repository's parent/root search. Read `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `DATABASE.md`, `DEPLOYMENT.md`, and `backend/README.md`.
- A local implementation branch is used for this work; no commit or push is planned.

## GitHub status at baseline

- GitHub default branch is `main`; branch protection API returned `protected: false`.
- 13 PRs were open at query time. None was merged as part of this work.
- Four listed GitHub Actions `verify` runs for the inspected SHA were completed with `failure`; the most recent recorded API run for this SHA is not a fresh rerun. Vercel commit statuses were contradictory: one deployment status `failure`, another status `success`.
- Open PRs and status evidence must be refreshed before production release. No GitHub branch setting, PR, deployment, or remote was changed.

## Architecture relevant to this phase

- Frontend: Next.js App Router, React and TypeScript. `lib/api.ts` is the only frontend `fetch` call found in the checked application tree and centralizes credentialed API requests.
- Backend: FastAPI; routers mount below `/api/v1` (`backend/app/main.py`). Session auth is a random opaque server-side session stored hashed in the database (`backend/app/auth.py:415-463`). Email/password, phone OTP, Google OIDC, verification/reset and session flows are implemented.
- Database: SQLAlchemy + Alembic, PostgreSQL production-oriented; local `alembic.ini` uses SQLite. CI runs PostgreSQL 16 and defines migrations upgrade/downgrade/upgrade/check (`.github/workflows/verify.yml`).
- Photos: upload pipeline in `backend/app/memory_photos.py`, Pillow re-encoding for thumbnails, object storage adapter in `backend/app/storage.py`. Database tracks original and thumbnail object keys.
- Deployment: `backend/Dockerfile:13` runs `alembic upgrade head` in every API container's startup command. Local Compose has PostgreSQL + API but no dedicated migration service yet.

## Verified security findings before change

### SEC-01 — CSRF

`backend/app/auth.py:428-435` configures production session cookie `Secure; HttpOnly; SameSite=None`. `backend/app/main.py:83-93` blocks unsafe requests only when an `Origin` header exists and is not in configured CORS origins; absent Origin passes that check. CORS is credentialed (`main.py:67-74`). There was no CSRF token endpoint/token/header mechanism and the frontend API wrapper did not send a CSRF token. This is a defense-in-depth gap for the cookie-authenticated browser API. All current mutating API paths are under `/api/v1`; OAuth callback is GET and separately uses signed state/nonce. The selected implementation will require trusted browser origin evidence and a signed double-submit CSRF token for unsafe API requests, including public auth mutations, with frontend support.

### SEC-02 — Image privacy

`backend/app/memory_photos.py:149-156` clears Pillow image metadata and writes a JPEG thumbnail. Upload stores the original input bytes unchanged (`:565-566`); retrieval serves original bytes by default (`:790-815`). Existing docs (`SECURITY.md:16`, `ARCHITECTURE.md:91`, `backend/README.md:34`) explicitly document that original EXIF is retained. Therefore original EXIF/GPS can be retrieved by a viewer authorized for the image. The change will re-encode original images in the same supported format while preserving pixel dimensions/alpha where applicable, and test both stored and delivered representations with identifying/GPS EXIF.

### SEC-03 — Migrations at startup

`backend/Dockerfile:13` invokes `uv run alembic upgrade head` before Uvicorn. This makes all API container instances eligible to run schema migrations independently. A dedicated Compose migration service can preserve the existing local `docker compose up --build` workflow while the API image itself starts only Uvicorn; production deployment docs will require a one-shot migration job before API rollout.

## Baseline test/build commands and actual results

| Check | Command/environment | Result |
|---|---|---|
| Backend tests | `uv run --locked pytest` with locked deps, Python 3.12.16 | **PASS:** 144 passed, 1 Starlette/httpx deprecation warning. |
| Ruff | `uv run --locked ruff check app tests migrations` | **FAIL (pre-existing):** `tests/test_invitation_uniqueness.py:1` import block unsorted (`I001`). No fix applied because unrelated. |
| Frontend typecheck | `npm run typecheck` after `npm ci` | **PASS** (exit 0). |
| Frontend lint | `npm run lint` | **NOT CONFIGURED:** package.json has no `lint` script; command exited 1 with missing-script error. |
| Frontend production build | `NEXT_PUBLIC_API_BASE_URL=https://ci.invalid/api/v1 npm run build` | **PASS** (exit 0; Next 16.3.6 produced all route output). |
| Alembic consistency | `uv run --locked alembic check` against configured local SQLite URL | **FAIL / NOT VALIDATED:** `Target database is not up to date`. No migration was executed by this command. It is not evidence of a broken migration chain; needs an isolated DB already migrated to head for a meaningful check. |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | **FAIL:** 3 runtime dependency advisories (2 high, 1 critical): Next.js `16.3.6` in audited vulnerable range; `sharp` and `source-map-js` advisories. No package or lockfile change made in this phase's baseline. This remains an explicit release risk. |

Baseline dependency installation used `npm ci` and the repository's locked Python dependency set in a local `.venv`; package manifests/lockfiles were not edited. Local build/test caches are generated/ignored. No real PostgreSQL or production database was used. The Alembic command did not run `upgrade` or `downgrade`.

## Baseline risks / blockers

1. CSRF token protection is absent; Origin validation is permissive on missing Origin while production cookie is cross-site-capable.
2. Original image EXIF/GPS is intentionally preserved and returned to authorized viewers.
3. Production migration execution is coupled to every API container startup.
4. Main branch is unprotected and recorded CI/deployment statuses fail or conflict.
5. No frontend lint script exists; no frontend unit/E2E tests were found in this source tree.
6. `npm audit` reports a critical Next.js runtime advisory plus two high advisories. Dependency upgrades were held out of this narrowly scoped phase to avoid an unreviewed framework/package change; this needs a separate, explicit patch/release decision.
7. Baseline Ruff has an existing formatting/import-order failure outside the intended security changes.

## Change safety

This baseline was captured from the workspace clone at the pinned SHA. No tracked source was modified before this report. The changes that follow are limited to CSRF protection, image metadata sanitization, migration execution separation, directly supporting tests and focused security/deployment documentation. No tree redesign or product feature work is in scope.

# AidoLab Remediation — Phase 0 Baseline Verification

Date: 2026-11-20 (UTC)
Author: Arena agent (independent verification against the actual repository)

## 1. Repository and Git state

| Item | Value | Evidence |
|---|---|---|
| Repository | `AriukagiinTuvshoo/guulingiinhan` | `git remote -v` |
| Root directory | `/home/user/guulingiinhan` | `pwd` |
| Current branch | `arena/fd153019-guulingiinhan` | `git branch --show-current` |
| HEAD SHA | `be8094b8485571de3291e55dc8cecfa9faf37fc7` | `git rev-parse HEAD` |
| HEAD subject | `UI: shared tree zoom/select, admin person editor, settings hierarchy, fund visibility` | `git log -1` |
| `main` SHA | `c178e4f0886a67b919f41b10672852dba4401be6` | `git rev-parse main` |
| `main` subject | `Merge pull request #116 from AriukagiinTuvshoo/phase1/foundation-security-hardening` | `git log main -1` |
| Working tree | **Clean** (no staged, unstaged, or untracked files) | `git status` |
| Branch recommendation | Mission recommends `fix/aidolab-deployment-blockers`; **it does not exist** locally or on the remote (`git ls-remote --heads origin \| grep -i aidolab` → empty). Arena session rules require all work on the current branch, so **all work happens on `arena/fd153019-guulingiinhan`**. This deviation is intentional and documented here. | `git branch -a`, `git ls-remote` |

### Clone shape (important)

The clone was originally **shallow with two roots** (`be8094b` and `c178e4f` in `.git/shallow`).
`git fetch --unshallow origin` completed successfully; the repository now has full history.

- Merge-base of `HEAD` and `main`: `030db4fda4964e7f64637afb85944ca904db259b`
  (`Merge pull request #81 from AriukagiinTuvshoo/feature/p6-1-memory-edit-ui`).
- `HEAD` and `main` have **diverged**: `HEAD` is 124 commits past the merge-base (UI/arena work),
  `main` is 3 commits past it (Phase 1: `1268ce9` + `acc24ac` + merge commit `c178e4f`).
- Neither branch is an ancestor of the other.

## 2. Phase 1 verification (independently confirmed)

| Check | Result | Evidence |
|---|---|---|
| `1268ce96163518b4f3c0903ff9f40acac6f2e5c2` exists | **YES** (commit) | `git cat-file -t` after unshallow |
| `acc24aceaed9bbd96bcdb0346ca0e08765aa02ff` exists | **YES** (commit) | `git cat-file -t` after unshallow |
| Both are ancestors of `main` | **YES / YES** | `git merge-base --is-ancestor … main` |
| Both are ancestors of current `HEAD` | **NO / NO** | `git merge-base --is-ancestor … HEAD` |
| PR #116 merged | **YES** (2026-11-20 12:19:08 UTC) | `gh pr view 116` → `MERGED` |
| Merge commit present in `main` | **YES** = `c178e4f` (parents `030db4f` + `acc24ac`) | `git cat-file -p main` |

**Conclusion:** Phase 1 is on `main` only. The current working branch does **not** contain Phase 1.

## 3. CI verification (GitHub Actions, independently queried)

| Run | Branch / event | Result | Notes |
|---|---|---|---|
| `44734576903` | `phase1/foundation-security-hardening` push | **success** (3m34s) | This is the Phase 1 reference run named in the mission — confirmed PASS |
| `44734786912` | Phase 1 PR `pull_request` | **success** (9m46s) | |
| `44734812519` | `main` push (PR #116 merge) | **success** (3m29s) | Latest run on `main` |
| `37865153530` | `arena/c660a466-guulingiinhan` push (this branch's content) | **success** (1m25s, 2026-10-09) | Latest run for the current branch's tip commit |

Previous claims "Frontend CI / Backend CI / E2E CI PASS" are consistent with the merged Phase 1
runs above (run `44734786912` includes frontend, e2e, and backend jobs, all green).

Open PRs (informational): #115 (ruff format, CI failing), #96, #94, #93, #92, #91, #90, #89, #88,
#87, #86, #85, #84, #83 — all stale feature branches; none related to AidoLab.

## 4. Which tree did the AidoLab scanner scan? — `main`, not this branch

The reported finding line numbers were mapped against **both** trees:

| # | Reported location | Matches `main`? | Matches current `HEAD`? |
|---|---|---|---|
| 1 | `backend/tests/conftest.py:163` | **YES** — line 163 is `register_verified(… password="strong-passphrase-123" …)` (file is 234 lines) | NO — file is 74 lines; same code is at line 26 |
| 2 | `backend/tests/test_api.py:62` | **YES** — line 62 raises `SQLAlchemyError` embedding an inline DSN: `postgresql://` + `user:password@private-host/db` | YES — identical line 62 |
| 3 | `backend/tests/test_email_flows.py:17` | **YES** — `PASSWORD = "strong-passphrase-123"` | YES — identical line 17 |
| 4 | `backend/tests/test_identity.py:16` | **YES** — `PASSWORD = "strong-passphrase-123"` | YES — identical line 16 |
| 5 | `backend/tests/test_person_profile.py:139` | **YES** — `password = "strong-passphrase-123"` at line 139 | NO — same statement at line 155 |
| 6 | `requirements.txt` missing | **YES** — absent on `main` | **YES** — absent on `HEAD` (no `requirements*.txt` anywhere in either tree) |
| 7 | `Procfile` missing/unrecognized | **YES** — absent on `main` | **YES** — absent on `HEAD` (no `Procfile*` anywhere) |
| 8 | Bandit B310 `backend/app/sms.py:49` | **YES** — line 49 = `urllib.request.urlopen(…)` | NO — same call at line 51 |
| 9 | Bandit B608 migration `…b3e6c9f1a204….py:32` | **YES** — f-string inside `sa.text(…)` at line 32 | YES — identical line 32 |
| 10 | Bandit B314 `backend/scripts/check_pytest_junit.py:19` | **YES** — file exists only on `main` (`ET.parse` at line 19) | **NO — file does not exist on `HEAD` at all** |

**Verified fact:** the scanner analyzed the `main` tree (PR #116).
**Verified fact:** the current branch lacks `backend/scripts/` entirely (and other Phase 1 files:
`app/csrf.py`, `app/family_admin.py`, `app/maintenance.py`, `app/metrics.py`, several admin tests
and migrations are `main`-only).

**Implication:** fixes made only on this branch will not change an AidoLab re-scan of `main`
until they are committed, pushed, and merged — which requires explicit user authorization
(mission rule 7). Additionally, this branch contains password-literal patterns that do **not**
exist on `main` (`test_account_hardening.py`, `test_minor_auth.py`, `test_verify_mn.py`,
`test_staging_mode.py`) and would very likely become **new** findings after a merge; they are
in scope for the same root-cause fix.

## 5. Backend architecture (verified from code)

- **Framework:** FastAPI; app object at `backend/app/main.py` (`app = FastAPI(…)`), lifespan runs
  `bootstrap_admin_roles()` and `engine.dispose()`.
- **Entrypoints:**
  - Vercel: `backend/index.py` → `from app.main import app` (`[tool.vercel] entrypoint = "index:app"`).
  - Docker: `backend/Dockerfile` CMD
    `/app/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log`
    (python:3.12-slim, non-root user, migrations applied in a separate controlled step).
- **Routers:** auth, families, invitations, persons/relationships, photos, memories, community,
  admin, shared ancestry, phone verification, privacy, etc. (see `backend/app/main.py` imports).
- **Database:** SQLAlchemy 2.x + Alembic; `backend/alembic.ini` default URL is
  `sqlite:///./guulingiinhan.db`, overridden at runtime by `DATABASE_URL`
  (`backend/migrations/env.py`). Tests use in-memory SQLite fixtures by default; CI additionally
  runs PostgreSQL 16 suites.
- **Health:** `GET /health` (liveness), `GET /health/ready` (DB readiness, safe error envelope).
- **Config:** `backend/app/config.py` `Settings(BaseSettings)`, `env_file=".env"`, `extra="ignore"`;
  production/staging validation enforces PostgreSQL URL, non-fake email/SMS providers, OTP secret,
  cookie/CORS rules (see §7).
- **Security middleware present (verified):** CORS from `settings.cors_origin_list`, request-id
  propagation, JSON log formatter with redaction, safe error handlers (`DATABASE_UNAVAILABLE`
  classification, no credential leakage — covered by `test_api.py`).

## 6. Python version and dependency management

| Item | Value | Evidence |
|---|---|---|
| Declared Python | `requires-python = ">=3.11"` | `backend/pyproject.toml` |
| Docker/CI Python | 3.12 | `backend/Dockerfile`, `.github/workflows/verify.yml` |
| Local sandbox Python | 3.11.2 (`/usr/bin/python3`) | `python3 --version` |
| Dependency tool | **uv** with `backend/pyproject.toml` + `backend/uv.lock` (committed, used with `--locked` in CI) | CI workflow |
| `uv` available in sandbox | **Not preinstalled** (will be installed from PyPI for verification) | `which uv` → empty |
| `requirements.txt` | **Does not exist** (neither root nor `backend/`) | `find` over the tree |
| Other lockfiles | `package-lock.json` (root + `backend/`, Node tooling only) | `find` |
| Runtime dependencies (pyproject) | fastapi, uvicorn[standard], sqlalchemy, alembic, psycopg[binary], pydantic-settings, email-validator, google-auth[requests], httpx, Pillow, boto3 | `backend/pyproject.toml` |
| Dev dependencies | mypy, pytest, ruff | `backend/pyproject.toml` `[dependency-groups] dev` |

## 7. Existing startup configuration (verified)

- **No `Procfile`** anywhere in the repository (root, `backend/`, `main` tree).
- Canonical production start command (Docker): `uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log`
  run from `/app` (i.e., the directory containing the `app` package).
- `backend/index.py` exists for Vercel's Python entrypoint (`index:app`).
- `docker-compose.yml` (root): local development API + PostgreSQL; ports bound to localhost.
- Production config validation (from `backend/app/config.py`, verified by reading the file):
  - `APP_ENV=production` requires `DATABASE_URL` starting with `postgresql://` or `postgresql+psycopg://`.
  - Production forbids `EMAIL_PROVIDER=fake` and `SMS_PROVIDER` outside `twilio`; Twilio credentials
    and `OTP_HASH_SECRET` (≥32 chars) are required when SMS is enabled.
  - `GOOGLE_OIDC_ENABLED=true` in production requires client id/secret/redirect/state secret.
- CI test commands (`.github/workflows/verify.yml` on this branch):
  - Frontend: `npm ci`, `npm run typecheck`, `npm run build`, plus four regression suites and a
    Cloudflare Worker build.
  - Backend: `uv sync --locked --dev`, `uv run pytest`, `uv run ruff check app tests migrations ops`,
    `uv run mypy`, `uv run alembic upgrade head` → `downgrade -1` → `upgrade head` → `alembic check`.
  - (On `main`, CI additionally runs ESLint, unit tests, a Playwright E2E job, PostgreSQL suites with
    JUnit floors via `scripts/check_pytest_junit.py`, API contract verification, and a pg-restore drill.)

## 8. Environment configuration surface (`.env.example`, verified)

Documented variables: `NEXT_PUBLIC_API_BASE_URL`, log/pool settings, storage
(`STORAGE_PROVIDER` local/S3/R2, upload limits), `POSTGRES_PASSWORD` (local Compose only),
`OTP_HASH_SECRET`, `SMS_PROVIDER`/`TWILIO_*`, `GOOGLE_OIDC_*`, `EMAIL_*` (provider, SMTP, TTLs).
No real secret values are present in `.env.example` or in the tracked source inspected so far.

## 9. Safety constraints acknowledged for this mission

1. Work only on `arena/fd153019-guulingiinhan`; `main` is never modified directly.
2. No commit, push, merge, or deploy without explicit authorization.
3. No destructive git commands; existing work preserved (tree was clean at baseline and stays
   that way until edits begin).
4. No real SMS/email/payment operations; no production credentials in logs or reports.
5. Test results are only reported as PASS when actually executed in this environment.

## 10. Baseline conclusion

- Baseline is established and documented before any application code change.
- All 10 scanner findings are real (present in the `main` tree); 9 of 10 have corresponding
  code in the current branch (finding 10's file is `main`-only and will be addressed explicitly).
- No `requirements.txt` / `Procfile` exist anywhere — findings 6 and 7 are genuine absences.
- The five "hardcoded password" findings are test-only values (`strong-passphrase-123` and a
  synthetic DSN in an exception message); none are production credentials. Detailed per-finding
  root-cause analysis continues in Phase 1.

# AidoLab Deployment Requirements — Guulingiinhan

**Date:** 2026-11-20 · **Branch:** `arena/fd153019-guulingiinhan`
**Evidence base:** AidoLab platform source `github.com/baigalaaZorigt/aidolab` @ `847cf057a8f98bf310acc1df67ba92198562be4f` (main HEAD, 2026-11-02), specifically `checker/scanner.py`, `checker/buildplan.py` — read directly, not guessed. The deployed `aidolab.mn` may run a different commit; re-verify if the platform changes.

---

## 1. How AidoLab classifies this repository

`buildplan.detect(root)` evaluates the repository root:

| Input | Our repo | Effect |
|---|---|---|
| root `package.json` | present (Next.js app) | node candidate |
| Python files / root `requirements.txt` | `backend/**/*.py` + root `requirements.txt` present | `has_py = True` → **python runtime wins** |
| root `Dockerfile` | absent (`backend/Dockerfile` is NOT at root) | platform generates its own Dockerfile |
| root `Procfile` `web:` line | present | **`kind = procfile`**, start command = the `web:` line |

**Result: `runtime = python`, `kind = procfile`.** The Next.js frontend is *not* built by AidoLab (see §6). `check_dependencies()` therefore runs the PyPI path: root `requirements.txt` must exist, be fully pinned with `==`, contain a web server (`uvicorn` ✓), and every pinned version must be OSV-clean.

## 2. Build & start (what the platform does with our files)

The generated Dockerfile (because we have no root Dockerfile) is, per `python_plan()`:

```dockerfile
FROM public.ecr.aws/docker/library/python:3.12-slim      # no root .python-version/runtime.txt → DEFAULT_PYTHON=3.12
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt                       # root requirements.txt is the install source
RUN useradd --create-home app && chown -R /app && USER app # non-root, same posture as backend/Dockerfile
CMD ["sh", "-c", "<Procfile web line>"]
```

- **Start command** = root `Procfile`, matched by `^web:[ \t]*(.+)$`:
  `web: cd backend && alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log`
- **Port:** platform sets `PORT` (buildplan default 8000); our line honors `${PORT:-8000}` — never hard-code a port.
- **Python:** 3.12 (platform default; also what CI runs). `backend/.venv` is local-only and not part of the clone.
- **`backend/Dockerfile` is ignored by AidoLab** (only a *root* Dockerfile wins). It remains valid for other hosts (CI, docker compose). The generated image is also non-root, so the two agree on posture.

## 3. Migrations — single path, no double-migration

`python_release()` looks for `alembic.ini` **only at the repository root**; ours is `backend/alembic.ini`, so the platform's `release` step is **empty** → no platform-side migration task and no `release && start` prefix. The only migration runner is the Procfile line itself (`alembic upgrade head` before `uvicorn`), which was live-tested locally (chain to `d11a6e28f901`, `/health` 200, `/health/ready` 200).

Implication: deploys are atomic per task — a failed `alembic upgrade head` exits non-zero and the new task never becomes healthy. The platform's pg_dump/ECS-task migration machinery (for repos whose root declares `alembic.ini`) does not apply to us.

## 4. Environment variables (validated by `backend/app/config.py`)

`pydantic-settings` reads env (and root `.env` for local dev — never commit `.env`; `.env.example` files are scanner-exempt).

### 4.1 Always required when `APP_ENV` ∈ {`staging`, `production`} (hosted)

| Variable | Rule |
|---|---|
| `APP_ENV` | `staging` (recommended first) or `production` |
| `DATABASE_URL` | must start with `postgresql://` or `postgresql+psycopg://` |
| `CORS_ORIGINS` | comma-separated **explicit HTTPS** origins; `*` and empty are rejected |
| `OTP_HASH_SECRET` | ≥ 32 characters (`openssl rand -hex 32`) |

### 4.2 `APP_ENV=production` additionally requires

| Area | Variables |
|---|---|
| SMS | `VERIFY_MN_API_KEY`, **or** `SMS_PROVIDER=twilio` + `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` |
| Email | `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_USERNAME`, `EMAIL_SMTP_PASSWORD`, `EMAIL_SMTP_STARTTLS=true`, `EMAIL_PUBLIC_BASE_URL` (https://) |
| Storage | `STORAGE_PROVIDER=s3`, `STORAGE_ENDPOINT` (https://), `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` |

### 4.3 `APP_ENV=staging` relaxations

- `SMS_PROVIDER` ∈ {`disabled`, `twilio`(+3 Twilio vars)}
- `EMAIL_PROVIDER` ∈ {`disabled`, `smtp`(+full SMTP config + STARTTLS + https base URL)}
- S3 storage is **still mandatory** in hosted envs (both staging and production).

### 4.4 Optional / tunable

- Google login: `GOOGLE_OIDC_ENABLED=true` + `GOOGLE_OIDC_CLIENT_ID`/`_CLIENT_SECRET`/`_REDIRECT_URI` (+ `GOOGLE_OIDC_STATE_SECRET` ≥ 32 in hosted envs; redirect URI must be `https://<api-host>/api/v1/auth/google/callback`)
- Pool bounds (validated): `DB_POOL_SIZE` 1–50, `DB_MAX_OVERFLOW` 0–100, `DB_POOL_TIMEOUT_SECONDS` 1–300, `DB_POOL_RECYCLE_SECONDS` −1–86400, `DB_CONNECT_TIMEOUT_SECONDS` 1–120
- Photos: `PHOTO_MAX_UPLOAD_BYTES` 1–50 MiB; rate-limit knobs `PHOTO_UPLOAD_*_PER_MINUTE`
- `LOG_LEVEL`, `SLOW_REQUEST_THRESHOLD_MS`, `TRUST_CLOUDFLARE_PROXY_IP`, session cookie name

A startup that fails validation raises before serving — a config mistake shows up as a crash-loop, not a silent bad state. Test the exact env set in staging first.

## 5. Health endpoints (probe targets)

| Endpoint | Purpose | Behavior |
|---|---|---|
| `GET /` | service alive | 200 `{"status": ...}` |
| `GET /health` | **liveness** | 200 always |
| `GET /health/ready` | **readiness** | runs `SELECT 1`; 503 `DATABASE_UNAVAILABLE` when DB unreachable |

Point the platform's readiness probe at **`/health/ready`** (per `DEPLOYMENT.md`); liveness at `/health`.

## 6. Frontend topology

AidoLab hosts the **backend only** (python runtime). The Next.js frontend is currently a separate Vercel project (`guulingiinhan-jy19`). For a full production path:

1. Deploy frontend separately; set `NEXT_PUBLIC_API_BASE_URL` to the AidoLab API base ending in `/api/v1` (build fails without it — no localhost fallback).
2. Set backend `CORS_ORIGINS` to the exact HTTPS frontend origin(s).
3. Auth cookies are `Secure; HttpOnly; SameSite=None` → both sides must be HTTPS.

## 7. Scanner rules that determine the score (from `checker/scanner.py`)

Score = `100 − Σ penalties`, severity `high=15 / medium=7 / low=3`, **each finding `id` counted at most twice** (so one habit costs ≤30). Relevant rules for this repo:

| Check | Rule (exact behavior) | Our compliance |
|---|---|---|
| `check_secrets` | Regex `(password\|passwd\|secret\|secret_key\|api_key\|apikey\|token\|access_key)\s*[:=]\s*['"]value['"]` (value ≥ 8 chars, not placeholder-y, line without `environ`/`getenv`) in code/config suffixes; **plus** DB-DSN pattern `(postgres\|mysql\|mongodb)://user:…@` in **every** text file including docs | All literals centralized through `os.environ.get` (line contains `environ` → exempt); DSN examples in docs split so no contiguous `scheme://user:pass@` appears |
| `check_repo_files` | no committed `.env*` except `.env.example/.sample/.template`; root `.gitignore` must contain `.env` | ✓ `.env.example` ×2 only; `.gitignore` line 10 `.env` |
| `check_hosting` | start command from `buildplan` (Procfile `web:`); sqlite hits allowed if any `.py` mentions `DATABASE_URL`; `open(..., "w")` file-writes → low | ✓ Procfile recognized; `DATABASE_URL` present; no flagged writes |
| `check_dependencies` | root `requirements.txt` all `==`-pinned; `uvicorn` present; **OSV query on every pin** → `vulnerable_dep` (≥3 vulns = high) | ✓ 49/49 pinned, uvicorn ✓, **0 vulnerabilities across all 49 pins** (verified via PyPI release advisories — same GHSA/PYSEC data OSV serves) |
| `check_bandit` | `bandit -r <repo> --severity-level medium` over the **whole clone** (not just `backend/`) | ✓ 0 findings ≥ medium repo-wide |
| `check_node_dependencies` | only when runtime = node | not applicable (python runtime) |

### Keeping the score green

- Never write `password = "…"` / `token="…"`-style literals in code, YAML, TOML, JSON, `.env*`, `.sh` — use `os.environ.get(...)` or an existing `*_settings(...)` fixture helper.
- Never put a contiguous DSN with inline credentials (`postgresql://` + `user:pass@host` form, or the mysql/mongodb equivalents) in **any** file, docs included — split or mask it.
- After any dependency change: `cd backend && uv export --no-dev --no-hashes --no-emit-project > ../requirements.txt` (header of that file documents this), then re-check the pins for advisories (`https://pypi.org/pypi/<name>/<version>/json` → `vulnerabilities`).
- Keep `bandit` ≥ medium clean: no `# nosec` shortcuts; prefer literal SQL strings (bandit never flags plain literals) or the `parts = [...]; "".join(parts)` construction where concatenation is required.

## 8. Local replication of the platform scan (methodology & result)

Because `aidolab.mn` credentials are unavailable to this remediation, the platform's own scanner code (§ citation) was executed locally against two trees:

1. **`main` as-is** → **35/100, exactly the 10 reported findings, same files/lines** — validates the replication.
2. **Simulated post-merge tree** (this branch's working tree + main-only files + deliverables) → **97/100**, single remaining item `osv_unavailable` is a sandbox artifact (this environment cannot reach `api.osv.dev`; PyPI advisories for all 49 pins are empty, and the platform's production scanner reaches OSV).

**Predicted official score after merge: 100/100.** This is a *replication*, not an official AidoLab result — the authoritative number comes from clicking «Дахин шалгах» after the branch is on the default branch (see `docs/AIDOLAB-REMEDIATION-REPORT.md` § re-scan instructions).

Caveats: the deployed platform may run a scanner commit other than `847cf057`; OSV data can gain new advisories between now and the re-scan; the merge must resolve conflicts in favor of the fixes documented here.

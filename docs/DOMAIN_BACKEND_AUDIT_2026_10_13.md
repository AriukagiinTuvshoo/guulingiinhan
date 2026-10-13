# Backend domain readiness audit — 2026-10-13

## Status and scope

**PASS — local backend verification**, with deployment/provider limits below.

- Branch: `codex/integration-regression-2026-10-02`.
- Audited starting commit: `d69228f` (`fix: atomic family onboarding and invited member identity flow`).
- Scope: authentication/session, global and family permissions, onboarding/invitations, private media, shared ancestry consent/review, rate limits, and local PostgreSQL transaction behavior.
- No live family database, production data, private backup, or remote media was read or changed. No commit, push, or deployment was performed by this audit.
- Preexisting untracked files and other agents' changes were preserved.

## Verified defect and correction

`_memory_visible_to_member` checked guardian access for minors but did not apply the private-person and current-family association rules already enforced by Memory detail.

Two disposable regressions demonstrated the discrepancy before the fix: Memory detail returned `404`, while `/families/{id}/memories` still returned its title/description and included it in `total`. A visible co-tagged person's memory list could also return the record.

The helper now applies the existing detail boundary to list results:

- A private tagged Person must belong to the viewer by creation or explicit account link.
- Every tagged Person must still be associated with the selected Family.
- Existing minor/guardian rules continue to apply.
- Untagged ordinary family memories remain visible; the private Person's authorized creator retains access.

Changed production source: `backend/app/families.py` (14 additions / 9 deletions). The correction filters access and does not alter Person, Family, tags, memories, relationships, or account records. No migration is required.

Regression source: `backend/tests/test_domain_security.py`, covering private and detached subjects, Memory detail/list/counts, visible-person memory lists, comments, and authorized creator access.

## Check results

| Check | Actual result | Scope |
| --- | --- | --- |
| Full pytest, once at starting HEAD | **328 PASS**, 323.96 s | Existing full API/operations tests; database API fixtures use SQLite |
| Privacy fix and related regression suite | **56 PASS**, 81.63 s | New regressions plus memory/media, guardianship, MVP API, and two-account isolation |
| Ruff | **PASS** | `app tests migrations ops` |
| Configured mypy | **PASS — 35 source files** | Installed mypy Python sources used because the Windows compiled extension is blocked |
| PostgreSQL test module | **8 PASS**, 5.36 s | Five database safety guards and three actual concurrent API cases |
| Alembic upgrade | **PASS** | Separate fresh local PostgreSQL database |
| Alembic downgrade one revision | **PASS** | `a72d9e410c8b` → `f6c2a9104b37` |
| Alembic upgrade again | **PASS** | Back to current head |
| Alembic consistency | **PASS** | `No new upgrade operations detected.` |
| Diff whitespace check | **PASS** | Audited backend change/test files |

The full suite preceded the discovered defect; the affected paths were then verified by the 56-test suite. The full suite was not repeatedly run. One dependency deprecation warning came from Starlette/httpx TestClient; it was not a functional failure.

## Actual PostgreSQL concurrency evidence

New opt-in module: `backend/tests/test_postgres_concurrency.py`.

The module accepts only an explicit `DOMAIN_POSTGRES_TEST_URL` with:

- Driver `postgresql+psycopg`.
- Loopback host.
- Database name beginning `guulingiinhan_domain_test_`.
- No URL query overrides.
- An initially empty database. Existing tables cause refusal.

It creates and drops only its own disposable schema. It does not fall back to the application's normal `DATABASE_URL`.

Actual runtime: **PostgreSQL 18.4**, fresh ignored cluster at `127.0.0.1:25433`, SCRAM authentication with an ephemeral password that was never printed. Real synthetic UserSession cookies and independent API transactions were used.

1. Two different Families referenced the same canonical pair. Both inverse parent-edge requests reached the real advisory lock concurrently. Exactly one returned `201`, the inverse returned `422`, and exactly one canonical edge remained.
2. Concurrent onboarding using the same request key returned the same Family and Person, with one Family/member/Person/association/account link.
3. Concurrent onboarding using different request keys also reused the same canonical identity without orphan or duplicate records.

Migrations ran on a second newly created disposable database. Evidence is in ignored `.integrated-qa/domain-postgres/results.json`; it contains runtime/status/database names and no credentials. After the interruption, `pg_ctl status`, the recorded PID check, and the loopback listener check confirmed no test server remained. The temporary password file was removed.

The temporary combined pytest/Alembic runner emitted closed-capture logging errors after pytest returned; its process exited successfully and all four migration operations completed. CI runs pytest and Alembic in separate processes, so this temporary capture issue does not change the application or the recorded check results.

## Security review conclusions

| Area | Reviewed safeguards and supporting tests |
| --- | --- |
| Auth/session | Opaque tokens stored as hashes, session expiry/logout, inactive/minor denial, verified email login, Secure/HttpOnly hosted cookies, exact allowed Origin on browser mutations; auth, staging, email, Google, and minor-auth regressions |
| Credential recovery | Expiring one-use email tokens, generic enumeration responses, session revocation on password/email change, no automatic Google account merge; email/account hardening and OIDC regressions |
| Role separation | Global SUPER_ADMIN/ADMIN/MODERATOR remain distinct from Family owner/editor/member; ordinary membership does not grant global administration or other-person profile edits; admin/person-policy regressions |
| Family isolation | Foreign family IDs and mismatched object IDs cannot authorize Person, Story, Memory, Archive, photo/original/download, root, or interaction access; two-account read/write/media regressions |
| Onboarding/invitation | Atomic self registration, canonical identity reuse only with explicit consent, private/minor source protection, active claim guard, verified recipient invitation acceptance, retry without regranting removed membership; onboarding/member/invitation regressions and actual PostgreSQL retries |
| Shared ancestry | Explicit consent, per-person pending review, SUPER_ADMIN approval, current requester/member/person eligibility revalidation, cycle/duplicate/parent/spouse constraints, safe projection detach and consent withdrawal; shared ancestry/request regressions |
| Media | Protected object delivery with family/person/guardian checks, validated object keys, bounded stream/decoded image size, EXIF-free portrait/thumbnail renditions, pending-storage states and retry cleanup; photo/account/storage regressions |
| Publication/cache | Explicit public heritage records only, public images require eligible adult/public subject tags, private JSON and denial responses use `private, no-store`; community/cache/isolation regressions |
| Rate limits | Shared database counters for login/email/provider requests and per-user/IP/family upload counters; forwarded IP trusted only by the configured private Cloudflare ingress; auth/upload/config regressions |

No additional verified backend defect remained after this correction within the reviewed scope.

## Limits and remaining release responsibilities

- Full API fixtures remain SQLite; the three named concurrency cases and reversible migration sequence were additionally exercised on actual PostgreSQL. This is not a claim that every API regression ran on PostgreSQL.
- The fresh PostgreSQL test administrator is not the production runtime role. Hosted RLS/grants and actual deployment configuration need their separate release evidence.
- This audit did not validate real SMS/Verify.MN delivery; that provider check belongs to the user as requested.
- Local tests do not prove live SMTP deliverability, R2 bucket configuration, DNS/TLS, final domain CORS/OIDC settings, authenticated staging browser behavior, or production restore execution. Those belong to the corresponding release checks.
- Media verification covers the implemented image paths; no video-upload support or real video delivery is claimed.

## Reproduction commands

From `backend`, using the repository's existing `.p12_3_backend_venv` Python or the supported `uv` environment:

```powershell
python -m pytest -q --basetemp=.pytest_cache/domain_backend_audit
python -m pytest tests/test_domain_security.py tests/test_memory_photos.py tests/test_memory_interactions.py tests/test_mvp_api.py tests/test_guardianship.py tests/test_security_release_gate.py -q
python -m ruff check app tests migrations ops
python -m mypy
```

For actual PostgreSQL verification, explicitly provide `DOMAIN_POSTGRES_TEST_URL` for a fresh loopback database meeting the guards, without committing or printing its password:

```powershell
python -m pytest tests/test_postgres_concurrency.py -q
```

With `DATABASE_URL` set to a **separate empty disposable local database**, the standard migration commands were verified:

```powershell
python -m alembic upgrade head
python -m alembic downgrade -1
python -m alembic upgrade head
python -m alembic check
```

**Production was NOT modified.**

# Line B Integration — Final Report (Phase 6/7)

Branch: `arena/b88fa06f-guulingiinhan` · PR: **#118** (open, not merged) · CI run **44993684739**: frontend ✅ e2e ✅ backend ✅

## 1. PostgreSQL CI failure — root cause

Three `tests/test_postgres_concurrency.py` tests failed in CI (`assert len(attempts) == 2` → `0 == 2`):

1. **The suite is new from line B and had never run anywhere** (line B had no CI).
2. **Reproduced locally against real PostgreSQL 16** (pgserver, UTF-8 cluster): the parallel requests were answered `403 CSRF_ORIGIN_REQUIRED` before reaching the handlers. Line B's tests used a bare `TestClient` with only the session cookie; main's #117 CSRF middleware requires an allowed `Origin` plus the double-submit token on every unsafe request. With no matching statements executed, the overlap barrier never saw two contenders.
3. **Secondary merge defect**: the workflow auto-merge renamed the postgres service database to `guulingiinhan_domain_test_ci` while the database-creation and restore-drill steps still connected to main's `guulingiinhan_test`, so "Create disposable PostgreSQL test databases" failed the first time the job reached it (all earlier runs died before that step).

## 2. Fixes made (implementation untouched; CSRF middleware untouched)

| Commit | Fix |
| --- | --- |
| `2d54d74` | Concurrency tests send requests through `CsrfTestClient` (Origin + signed double-submit), so they satisfy the browser contract and genuinely exercise the advisory-lock / user-row-lock paths. |
| `f67c4b3` | Tree workspace `loadTree` restored to main's scope contract (`all`/`context`); backend pytest failures annotated in CI. |
| `6f93841` | `/tree` default view = family workspace (line B's shared tree via `?view=shared`); `/people` = main's 470-line People Directory + line B members hub as `components/people-members-hub.tsx`; `.cloudflare` lint ignore. |
| `f3e65a1` | Postgres service wiring reconciled: service default `guulingiinhan_test` (main), `DOMAIN_POSTGRES_TEST_URL` → `guulingiinhan_domain_test_ci`, disposable DB creation moved before pytest, domain DB added to the created list. |
| `861d77d` | The merge itself: 21 conflicts resolved; `profile_photos.py` `_image_payload` unpack fixed (sanitized JPEG, not PNG original); work-scope auth model kept; migrations joined via `a3f7c5d90e1b`. |

## 3. Feature recovery inventory

| Feature | Source | In main 748329c | In staging f0a5f71 | Now (PR #118) |
| --- | --- | --- | --- | --- |
| WOW / heritage dashboard | line B | ❌ | ✅ | ✅ (+ adapted e2e) |
| 3D family tree | main | ✅ | ✅ | ✅ (unchanged) |
| Tree navigation / branch view | main + line B tabs | ✅ | ✅ | ✅ (tabs; default = family) |
| Root connection / linking UX | line B | ❌ | ✅ | ✅ (`/ancestry/connect`, regressions green) |
| People Directory | main | ✅ | ❌ (replaced) | ✅ restored |
| Members hub / self link-request | line B | ❌ | ✅ | ✅ (same route, under directory) |
| Atomic onboarding (`/families/onboarding`) | line B | ❌ | ✅ | ✅ (+ concurrency-proven on PG) |
| Stories / memories | main | ✅ | ✅ | ✅ (unchanged) |
| Timeline / archive | main | ✅ | ✅ | ✅ (unchanged) |
| Family funds visibility + public funds API | line B | ❌ | ✅ | ✅ (migration `f6c2a9104b37`) |
| Admin photo endpoints + admin ancestry | line B | ❌ | ✅ | ✅ |
| Admin console (main pages) | main | ✅ | ❌ (partially) | ✅ kept; `/admin/console` present but unlinked (as in main) |
| Auth / account security | main | ✅ | ✅ | ✅ (`auth.py` byte-identical to main) |
| Notifications / announcements | main + line B | ✅ | ✅ | ✅ |
| PWA manifest + service worker | line B ≥ ac013a3 | ✅ | ✅ | ✅ (`manifest.webmanifest`, `sw.js`) |
| Family privacy / guardian scopes | both | ✅ | ✅ | ✅ (guardianship + domain-security suites green) |

Missing from the merged branch relative to line B: none found. Missing relative to main: none.

## 4. Security audit result (#117 intact)

- `auth.py`, `csrf.py`, `relationships.py`, `privacy.py` — **byte-identical to main** (`git diff` empty). CSRF origin/double-submit middleware untouched; it demonstrably still rejects non-browser clients.
- Family-level authorization: main's work-scope model (`owner/editor`, `FamilyAdminWorkGrant`, self-link) kept for person writes, biography, events, lineage assignment, featured person, relationship creation, person removal; line B's AdminGrant-based person-admin model reverted (global grants never satisfy family-scoped checks — asserted by tests).
- User/person linkage: link-request approval flow + `link-me`; minor records require guardian scopes (`edit_profile`/`view_profile`/`manage_biography`) — `test_guardianship` green.
- Cross-family isolation: shared-tree projection filters edges across family connections; `_guard_shared_relationship_change` (line B) + advisory lock (main) serialize canonical graph writes; inverse-edge concurrency test proves serialization on PG.
- Photos/memories: profile photo uploads store the sanitized JPEG (bug fixed); admin photo endpoints re-check eligibility; account/memory photo auth unchanged.
- Migrations: single head `a3f7c5d90e1b` (two-parent merge of `6b31cc42c423` + `a72d9e410c8b`); `upgrade head → downgrade base → upgrade → alembic check` clean on real PG; production guard intact.

## 5. Exact CI results (run 44993684739, commit f3e65a1)

- **frontend**: ESLint (0 errors), unit tests, typecheck, Next build (40 routes), route regression, tree-3d, root-linking, heritage, private-media backup, vinext worker build — **success**.
- **e2e**: Playwright chromium — dashboard memories contract, dashboard empty state, responsive (login/tree/families/clan/admin at 360–1440px), admin workflows, admin people pagination, online journey (mobile 390px) — **success**.
- **backend** (locally reproduced + CI): SQLite pytest 445 passed/3 skipped; PostgreSQL pytest **448 passed**; trash concurrency 4; pagination 1; junit floor 448 ≥ 204; ruff; mypy (39 files); API contract; alembic upgrade → downgrade base → upgrade → check; backup/restore drill.

## 6. Staging deployment

**Not deployed — blocked, no staging change to report.** Staging (`https://guulingiinhan-staging.tuvshoo0331.workers.dev`) builds only from `codex/integration-regression-2026-10-02` and still serves `f0a5f71`. This session is restricted to `arena/b88fa06f-guulingiinhan`, no Cloudflare credentials are available in the sandbox, and PR #94 must not be merged manually — so the exact deployed SHA cannot be changed or verified from here. Options: (a) merge PR #118 into main and repoint the staging trigger (Cloudflare console → Workers Builds), (b) provide CF credentials/API token, or (c) explicitly authorize pushing the integration commit to the codex staging branch. The Cloudflare "Workers Builds" check fails on non-codex branches (pipeline config), so branch previews are not produced either.

## 7. Real UI verification

Local Playwright is impossible in this sandbox (apt unreachable), so browser-level verification is the CI e2e run (Playwright chromium, production build, real routes): heritage dashboard memories contract + empty state, tree workspace region + search-select, people directory search (`Гэр бүлийн хүн хайх`), responsive no-overflow at 360/390/430/768/1024/1280/1440px, admin hub/people/trash, mobile online journey — all passing on commit `f3e65a1`. Staging screenshots are pending the deployment above.

## 8. Remaining blockers

1. Staging deployment (see §6) — needs user authorization/credentials.
2. Cloudflare Workers Builds check fails on non-codex branches — pipeline config in the CF console.
3. `/admin/console` exists but nothing links to it (unchanged from main — pre-existing, documented as-is).
4. Playwright cannot run in this sandbox (no apt) — e2e relies on CI (green).

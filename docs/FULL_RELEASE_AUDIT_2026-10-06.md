# Full release audit — 2026-10-06

## Baseline (before code changes)

- Branch: `codex/integration-regression-2026-10-02`, clean checkout.
- Commit: `ab3566a60653e7d2a0a6ac01e622b423c8628c27`.
- Open integration PR: [#94](https://github.com/AriukagiinTuvshoo/guulingiinhan/pull/94). Other open PRs are historical; none will be merged.
- Migration head: `b10c8e621f4a`.
- Staging frontend: `8cd16ca4-c66f-4347-a1f5-bd5f12cd79a7`, 100% traffic.
- Staging backend: `a6b68328-925a-4422-9347-25567e036b4f`, 100% traffic (owner configuration update after the previous code deploy).
- Cloudflare secret NAME `VERIFY_MN_API_KEY` exists. Value was not accessed.

## Architecture inspected

Next/React App Router with Vinext Cloudflare deployment; FastAPI runs inside the existing Cloudflare Container. SQLAlchemy/PostgreSQL, Alembic, private R2 via S3 API remain in use. The Worker forwards requests and passes an explicit environment allowlist into the Container. Canonical Person/Family/ParentChild/Marriage/UserPersonLink remain the genealogy source. Shared ancestry is a consent-controlled projection. Global admin grants are separate from family memberships. Explicit published heritage content has an authenticated community entry point; it does not publish entire Person profiles or trees.

## Required behavior, findings, risks and proposed changes

| Area | Existing behavior / gap | Risk | Proposed change / verification |
| --- | --- | --- | --- |
| Login | Email/password works; phone UI calls SMS OTP login endpoints. | Violates new normal-login requirement and depends on delivery for sign-in. | Unified identifier/password login, retain old email request compatibility; phone login must not call a provider. |
| Registration | Email requires verification; phone registration is OTP-first and creates a passwordless account. | Cannot register then login then verify phone as requested. | Password-based phone registration with an unverified identity; keep ownership proof separate. Recheck email-verification boundary. |
| Verify.MN | Secret configured but Settings/provider and Worker Container env omit it. | A saved Worker secret alone cannot reach FastAPI. | Explicit backend-only forwarding and provider implementation using documented API; never expose key. |
| Provider contract | Verify.MN is mobile-originated SMS, not an outbound OTP sender. POST `/sessions`, GET `/sessions/{id}`; unsigned callback is only a wake-up signal. | Treating a client code/callback as proof permits takeover. | Server stores provider session bound to local account/purpose/phone, verifies provider status server-side; no callback required when polling. |
| Phone change | Existing authenticated flow only adds a verified identity; lacks explicit replacement and reauthentication. | Old identifiers remain active; sensitive changes insufficiently explicit. | Verify new number before replacing current identity, current-password reauthentication, uniqueness/rate/single-use tests. |
| Recovery | Email tokens and legacy phone OTP reset exist, revoke sessions. | New Verify.MN contract not supported. | Preserve email path; add provider-backed phone reset bound to verified identity and local challenge, generic requests, expiry/reuse protection. |
| Account / Admin | Display name, identity listing, Person photo and role/status controls exist. | Account photo/email/phone management and verified state need complete audit. | Add only missing authorized controls; recovery initiation must not expose hashes, passwords or secrets. |
| Family / Person | Server membership helpers, explicit frontend context, approved links, minor controls exist. | Earlier test results do not establish this candidate's correctness. | Re-run endpoint matrix and permission regressions; preserve no fallback and no arbitrary claiming. |
| Tree | Canonical root/branch relationships and marriage occurrences, 2D/3D retained. | New auth work could break consumers; algorithm timing alone is not full runtime performance. | Preserve renderers; test actual 800-person UI/mutations/navigation and branch context. |
| Content / media | Private family data and published public heritage APIs, private R2 delivery, EXIF processing exist. | Media references may cross visibility boundaries; Archive binary previews not implemented. | Full cross-family/public/private regression; record missing capabilities explicitly. |
| Database recovery | Prior encrypted all-44-table isolated restore evidence exists. | Previous evidence is not a current rerun; provider-native DR and portable custody incomplete. | Reverify actual integrity/restore/application reads and guards; no provider-native PASS without evidence. |
| Media recovery | Encrypted native R2 helper and tests exist; actual export/restore incomplete. | Binary API adapter is lossy; previous standard request blocked by CF 1010. | Complete only through authorized access; do not bypass access controls or count tests as actual backup. |
| Accessibility / mobile | Focus hook and prior targeted local checks exist. | Local checks are not staged mobile or WCAG certification. | Repeat keyboard/AX/contrast/viewport checks after changes and separately record staged limitations. |
| Tests / deployment | Pytest/Ruff/frontend/migration CI exists; backend typechecking absent. | A green existing build omits the new auth contract and some required gates. | Add meaningful backend typechecking, provider/auth regression; run complete suite, migration cycle, staged runtime. |

## Verification policy and owner actions

All candidate gates start **NOT TESTED**. Static findings above are not runtime PASS. Previous evidence will be revalidated. Real Verify.MN requires an approved test phone and owner sending the displayed SMS; email delivery requires an approved separate mailbox. Those contacts have been requested without requesting credentials. No real owner credential changes, production deployments, DNS changes, Google enablement, automatic PR merges, or private data publication are authorized by this task.

Provider reference inspected: [Verify.MN API contract](https://www.verify.mn/) on 2026-10-06. Polling is sufficient; a callback is optional. API credentials stay on the backend. Provider messages and status payloads must never be logged. The shared public session-status endpoint alone must not authorize any application action without matching the server-owned session record.

## Execution evidence

- Backend full regression: 222 tests passed, zero skipped (fresh disposable temp directory); one upstream TestClient deprecation warning. Mypy checks all 29 application modules; Ruff passed.
- PostgreSQL 18 isolated migration drill: full upgrade, downgrade last revision, upgrade again, consistency passed for `c16a4e8b9021`.
- Frontend: clean `npm ci`, typecheck, Next build, 25 route checks, 800-node algorithm regression, root-path/content regression, 3 encrypted media unit tests, Vinext build passed. Runtime measurements and staged evidence remain separate.
- Dependency audit: patched `source-map-js` to 1.2.2 and `undici` to 7.29.1. Remaining 7 high advisory entries are the unpatched `braces` <=3.0.3 dependency chain through the build-time CommonJS/glob plugin. No forced adapter downgrade. Runtime reachability requires verification; no vulnerability-free claim.
- Staging database metadata: 45 public tables (44 app tables + Alembic marker); only root_connections has RLS. Direct `anon` and `authenticated` table SELECT grants are zero. Backend role `guulingiinhan_staging_app` has neither SUPERUSER nor BYPASSRLS. Existing FastAPI Family checks remain the application boundary. Proposed defense: enable RLS on the 43 remaining application tables with policies restricted to the existing dedicated staging backend role, without adding grants or changing the root_connections policy. Persist exact SQL/rollback; verify privileged backend access and unprivileged denial. This is staging infrastructure hardening, not a new genealogy schema.
- Staging hardening applied: head `c16a4e8b9021`; all 44 app tables now have RLS, `anon`/`authenticated` SELECT grants remain zero. The Supabase control role cannot SET ROLE to the app role; no extra role membership was granted. Dedicated-role access is verified through staging runtime rather than impersonating it in the control tool.
- Current encrypted database recovery rerun: all 44 tables, exact row comparison, schema consistency, 8 authorized application reads / 8 anonymous denials and populated-target protection PASS. Private R2 readback of 48,369 encrypted bytes matched SHA-256 `5ef2a8b64663ee07b60e25aff89e50b0fdb9d09de4a20f946e00f1b35931709a`.
- Actual media recovery: native R2 Workflow exported 3 objects / 775,777 source bytes; ciphertext downloaded and AES-GCM / RSA-OAEP verified; restored checksums match. Three restored private-media API paths returned data to the authorized principal and denied anonymous access. Temporary Workflow and Worker deleted (both HTTP 200). No public HTTP execution route, recurring schedule, header impersonation or production write used.
- Browser local UI: new phone registration/password login/post-login verification/recovery (controlled provider fixture) and private account photo upload/display/removal PASS; 51 route/viewport checks at 390×844, 768×1024, 1440×1000, zero uncaught errors/HTTP 5xx, account-security axe zero violations after contrast/target fixes. These do not establish real SMS delivery or staged mobile PASS.
- Performance discovery: full-view UI was limited to 300 persons by a hardcoded API cap. Added an explicit 1–1,000 bounded parameter (default remains 300); full UI requests 1,000. Four tree regression cases passed, including upper-bound rejection and anonymous denial. Actual local browser now loads/renders all 800 people, 799 parent-child links and 90 marriage occurrences on desktop and mobile. Timing evidence will be attached with environment limits; no production/GPU benchmark claim.

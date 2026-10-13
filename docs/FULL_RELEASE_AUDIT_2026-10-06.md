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

- Backend full regression: **224 tests passed, zero skipped** (fresh disposable temp directory); one upstream TestClient deprecation warning. Mypy checks all 29 application modules; Ruff passed.
- PostgreSQL 18 isolated migration drill: full upgrade, downgrade last revision, upgrade again, consistency passed for `c16a4e8b9021`.
- Frontend: clean `npm ci`, typecheck, Next build, 25 route checks, 800-node algorithm regression, root-path/content regression, 3 encrypted media unit tests, Vinext build passed. Runtime measurements and staged evidence remain separate.
- Dependency audit: patched `source-map-js` to 1.2.2 and `undici` to 7.29.1. Remaining 7 high advisory entries are the unpatched `braces` <=3.0.3 dependency chain through the build-time CommonJS/glob plugin. No forced adapter downgrade. Runtime reachability requires verification; no vulnerability-free claim.
- Staging database metadata: 45 public tables (44 app tables + Alembic marker); only root_connections has RLS. Direct `anon` and `authenticated` table SELECT grants are zero. Backend role `guulingiinhan_staging_app` has neither SUPERUSER nor BYPASSRLS. Existing FastAPI Family checks remain the application boundary. Proposed defense: enable RLS on the 43 remaining application tables with policies restricted to the existing dedicated staging backend role, without adding grants or changing the root_connections policy. Persist exact SQL/rollback; verify privileged backend access and unprivileged denial. This is staging infrastructure hardening, not a new genealogy schema.
- Staging hardening applied: head `c16a4e8b9021`; all 44 app tables now have RLS, `anon`/`authenticated` SELECT grants remain zero. The Supabase control role cannot SET ROLE to the app role; no extra role membership was granted. Dedicated-role access is verified through staging runtime rather than impersonating it in the control tool.
- Current encrypted database recovery rerun: all 44 tables, exact row comparison, schema consistency, 8 authorized application reads / 8 anonymous denials and populated-target protection PASS. Private R2 readback of 48,369 encrypted bytes matched SHA-256 `5ef2a8b64663ee07b60e25aff89e50b0fdb9d09de4a20f946e00f1b35931709a`.
- Actual media recovery: native R2 Workflow exported 3 objects / 775,777 source bytes; ciphertext downloaded and AES-GCM / RSA-OAEP verified; restored checksums match. Three restored private-media API paths returned data to the authorized principal and denied anonymous access. Temporary Workflow and Worker deleted (both HTTP 200). No public HTTP execution route, recurring schedule, header impersonation or production write used.
- Browser local UI: new phone registration/password login/post-login verification/recovery (controlled provider fixture) and private account photo upload/display/removal PASS; 51 route/viewport checks at 390×844, 768×1024, 1440×1000, zero uncaught errors/HTTP 5xx, account-security axe zero violations after contrast/target fixes. These do not establish real SMS delivery or staged mobile PASS.
- Performance discovery: full-view UI was limited to 300 persons by a hardcoded API cap. Added an explicit 1–1,000 bounded parameter (default remains 300); full UI requests 1,000. Four tree regression cases passed, including upper-bound rejection and anonymous denial. Actual local browser now loads/renders all 800 people, 799 parent-child links and 90 marriage occurrences on desktop and mobile. Timing evidence will be attached with environment limits; no production/GPU benchmark claim.

## Final candidate and release gate (2026-10-06)

### Repository and deployment identity

- Branch: `codex/integration-regression-2026-10-02`.
- Candidate commit: `d68c1ec760e07561eed6f8c1ba39da97c40ad25a` (`Record final production readiness evidence`), pushed to `origin`; includes code candidate `92ce284737c64d6c386c65670ce7fc2b80658b90`.
- Integration PR: [#94](https://github.com/AriukagiinTuvshoo/guulingiinhan/pull/94), open and not merged.
- CI workflow `verify`, run `37423592407` (#1176), for the final candidate commit: completed successfully.
- Migration head: `c16a4e8b9021`; staging migration is applied.
- Latest staging frontend Worker version `3054fdc2-0662-4b0b-a366-759ca3c03f72` (#53), 100% traffic, uploaded `2026-10-06T06:25:49Z`.
- Latest staging backend Worker version `d4430279-a5ec-4f70-bcee-24cd312716ce` (#72), 100% traffic, uploaded `2026-10-06T06:25:35Z`.
- Guest smoke evidence was captured against the preceding code deployment (#52/#71). The post-report upload (#53/#72) is visible in Cloudflare, but this environment could not resolve the staging host during a repeat HTTP smoke; no post-upload runtime PASS is claimed.
- Production: not deployed or modified. Production DNS, secrets, and family data were not touched.

### Final feature matrix

Statuses describe the evidence actually available. Local/automated evidence is not represented as authenticated staging proof.

| Area | Status | Evidence |
| --- | --- | --- |
| Auth | PASS | Backend auth regression and local browser registration/login/recovery flows pass; unified email-or-phone plus password is implemented. |
| Email login | PASS | Password login is covered by backend and browser tests. Real SMTP delivery, mailbox verification, and reset delivery are NOT TESTED. |
| Phone login | PASS | Phone/password path passes backend and local browser tests without an SMS login challenge. |
| Phone verification | BLOCKED | Controlled-provider tests pass. No owner-approved test phone/live SMS was supplied; owner deferred this test. |
| Verify.MN | BLOCKED | Documented MO-SMS flow and server-side session polling are implemented; secret is backend-only. Real provider delivery and live challenge cases remain unverified. |
| Password reset | BLOCKED | Local email/phone reset and token security cases are tested. Real email and Verify.MN delivery were deferred, so both external recovery channels lack end-to-end evidence. |
| Profile | PASS | Account photo upload/read/delete, private media access, and account-security flows pass local browser/backend tests. Authenticated staging UI was not inspected. |
| Phone change | BLOCKED | New-number verification and replacement logic are covered by local tests; live Verify.MN proof was not performed. |
| Admin | BLOCKED | Authorization and recovery safety are covered by automated tests. Authenticated staging admin QA could not be performed; external browser capture was rejected by automatic privacy review. |
| User ↔ Person | PASS | Linking/ownership rules and unauthorized-claim regressions pass; staging anonymous requests are denied. |
| Family authorization | PASS | Cross-family authorization regression passes; staging RLS is enabled on all 44 application tables, with no anon/authenticated SELECT grants. |
| Tree | PASS | Root-linking and 800-person/799-parent-link/90-marriage local browser regression pass; full view now requests up to the API's 1,000-node bound. |
| Marriage history | PASS | Marriage occurrence regression passes in the 800-person tree dataset. |
| Branch navigation | PASS | Root-linking and Tree route/regression suites pass. |
| Stories | PASS | Heritage regression passes for supported public/private behavior. Authenticated staging walkthrough was not performed. |
| Memories | PASS | Heritage regression passes for supported visibility and media behavior. Authenticated staging walkthrough was not performed. |
| Archives | PASS | Automated access/heritage regression passes for implemented archive capabilities. Authenticated staging walkthrough was not performed. |
| Public content | PASS | Explicitly published content behavior is covered by backend regressions; staging anonymous smoke confirms protected application routes reject anonymous access. Cross-account authenticated staging viewing was not performed. |
| Private content | PASS | Backend family-isolation tests and staging anonymous denial checks pass; the full two-account staging test remains unperformed. |
| Media | PASS | Private account photo tests pass. Actual encrypted R2 recovery verified 3 objects / 775,777 source bytes and authorized reads with anonymous denial. |
| Backup | PASS | Current encrypted staging database export covers all 44 application tables with matching R2 object checksum evidence. Long-term provider-native retention/custody is BLOCKED. |
| Restore | PASS | Isolated PostgreSQL restore verified schema and exact table row comparisons; 8 authorized reads and 8 anonymous denials passed. Three restored private-media paths passed access checks. |
| Accessibility | PASS | Targeted keyboard/accessibility run: 16 checks passed; axe reported zero violations after fixes. This is not a formal WCAG certification. |
| Mobile | PASS | Local browser covered 51 route/viewport checks at 390×844, 768×1024, and 1440×1000 with no overflow, uncaught errors, or HTTP 5xx. Authenticated staging mobile QA was not performed. |
| Performance | PASS | Local 800-person browser test: full tree API 764 ms; initial 2D DOM about 3.0 s desktop/mobile; no overflow or JS errors. Measurements exclude production hardware/GPU and staging network variability. |
| Security | PASS | Auth, family boundaries, session/rate-limit protections, private media, and stage RLS regressions pass. Seven high npm audit findings remain in the build-time `braces` dependency chain; reachability is unverified. |
| Automated tests | PASS | 224 pytest passed; Ruff, Mypy (29 modules), migration cycle/consistency, npm ci, typecheck, Next build, Vinext build, 25-route, tree, root-linking, heritage, and media recovery tests passed. CI run #1175 succeeded. |
| Staging runtime | BLOCKED | Guest smoke on preceding code deployment (#52/#71): login/register/reset/admin ancestry HTTP 200; health/readiness 200; protected endpoints 401 anonymously; no JS errors/5xx. Latest versions #53/#72 are 100% but could not be smoke-checked after upload because this environment could not resolve the staging host. Authenticated staging checks could not be safely captured through the external browser tool. |

### Remaining blockers and owner actions

1. Run live Verify.MN verification, phone change, and phone recovery with an owner-approved disposable test number. This sends paid SMS (the documented destination charges 150 MNT); the owner previously deferred the test.
2. Run live email registration/verification and email recovery using an approved disposable mailbox. This was also deferred; do not use the owner's personal mailbox or change their account.
3. Complete authenticated staging checks for Admin, Profile, Settings, Tree, content, media, logout, and cross-family access. The attempted external TinyFish capture was rejected by automatic privacy review because it could transmit private genealogy/account details. Use the owner's own browser for those checks or an approved in-environment method that does not export private page content.
4. Establish and evidence provider-native backup retention, independent key custody, and scheduled restore operations. The isolated encrypted drill does not establish those operational controls.
5. Resolve or formally assess the seven high build-chain `braces` advisories. Current evidence identifies the chain but does not establish exploitability or a safe upstream upgrade.
6. Before production release, review and explicitly approve production deployment, domain/DNS, secrets, and live contact tests. No production action is authorized or has occurred in this audit.

### Production decision

**NOT READY** — real Verify.MN and email delivery, authenticated staging regression, operational backup/key custody, and the remaining high dependency advisories do not have the required release evidence. The implementation and automated/guest staging checks are materially complete, but they do not satisfy the prompt's no-false-PASS production gate.

# Guulingiinhan — Final master production readiness

**Audit date:** 2026-10-06  
**Decision:** `BLOCKED — OWNER ACTION REQUIRED`  
**Release state:** `NOT READY`

## A. Repository and deployment

- Repository: `AriukagiinTuvshoo/guulingiinhan`
- Branch: `codex/integration-regression-2026-10-02`
- Starting commit for this continuation: `e67790fc6ea98fe765dc8f6aa2009644dc68f02b`
- Integration PR: [#94](https://github.com/AriukagiinTuvshoo/guulingiinhan/pull/94), open; not merged.
- Migration head: `c16a4e8b9021`; staging is migrated to this head.
- Cloudflare staging frontend: `c740ab61-876d-44eb-8ee4-37bca6f35161` (#54), 100% traffic, deployed `2026-10-06T06:54:38Z`.
- Cloudflare staging backend: `62d0704e-8c1a-442a-89c8-7f3e752c7166` (#72), 100% traffic, deployed `2026-10-06T06:29:14Z`.
- Guest smoke was repeated against frontend #54/backend #72 after the dependency-scope change: four application routes returned HTTP 200; backend health and readiness returned HTTP 200; four protected API requests returned HTTP 401 anonymously. No authenticated cookie or private family identifier was sent.
- No production deployment, DNS, secret, credential, or family-data change was made.

## B. Changes in this continuation

- `package.json`, `package-lock.json`: moved `vinext` and `@vinext/cloudflare` from production dependencies to development dependencies. They are Vite/Cloudflare build and deployment tools; application source imports the Vinext server handler, which is bundled into the Cloudflare Worker during build. The generated Worker bundle contained no `braces`, `micromatch`, `fast-glob`, or `vite-plugin-commonjs` code/string matches.
- No database or genealogy data change.
- The dependency classification change is local and tested. Do not consider it deployed until the new branch commit and subsequent staging version are verified.

## C. Dependency security assessment

- Installed chain: `vinext@1.0.0 → vite-plugin-commonjs@0.10.4 → vite-plugin-dynamic-import@1.6.0 → fast-glob@3.3.3 → micromatch@4.0.8 → braces@3.0.3`.
- Current GitHub advisory: [CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/ghsa-vfj7-8cjw-p6xm), high severity (CVSS 8.7). It describes stack exhaustion from deeply nested brace patterns and currently lists no patched version. The maintainer's [issue #70](https://github.com/micromatch/braces/issues/70) describes the same recursion depth condition.
- Exposure assessment: the vulnerable package is now absent from the production dependency graph (`npm ls --omit=dev braces --all` returned empty). The build dependency remains installed for Vite compilation. In this application the brace patterns are build-time glob inputs from source/config; no request-time route accepts a brace pattern. The verified Cloudflare Worker output did not include the dependency chain. The residual impact is build/CI process availability if attacker-controlled patterns reach a build, not a demonstrated request-time production path.
- `npm audit --offline --json` returned zero findings because it had no current advisory feed; it is not used as proof of remediation. An online `npm audit` could not reach `registry.npmjs.org` because DNS resolution failed. The GHSA remains the authoritative known advisory for this audit.
- Decision: `PARTIAL — production dependency exposure removed; build-time advisory remains pending upstream patch and fresh online audit`. No arbitrary version override or unreviewed patch was applied. This is not a zero-vulnerability claim.

## D. Verification performed in this continuation

- `npm ci --offline`: PASS, 207 packages installed from cache. A restricted-runner attempt first failed with Windows `EPERM`; the authorized elevated retry completed successfully.
- `npm run typecheck`: PASS (elevated runner; SWC could not canonicalize this isolated checkout under the restricted runner).
- `npm run build`: PASS; 29 routes generated.
- `npm run build:vinext`: PASS; Cloudflare Worker build completed. Existing dynamic-import and route-classification warnings remain informational.
- `npm run regression:routes`: PASS, 25 routes.
- `npm run test:tree-3d`: PASS, 800 people, 799 parent-child edges, 90 marriage edges; 26.94 ms median layout-only time.
- `npm run test:root-linking`: PASS.
- `npm run test:heritage`: PASS.
- `npm ls --omit=dev braces --all`: PASS, empty production tree.
- An online audit could not be completed from this runner due registry DNS failure. The current full-development dependency audit therefore remains PARTIAL.
- Existing baseline evidence retained: 224 backend tests passed, zero skipped; Ruff, Mypy across 29 modules, PostgreSQL upgrade/downgrade/upgrade/consistency, 16 targeted keyboard/accessibility checks with zero axe violations, and encrypted database/media restore checks passed before this frontend-only manifest change. CI must rerun on the resulting branch commit.

## E. Final master feature matrix

Statuses cover only the evidence stated in each row. Local tests do not imply authenticated staging success.

| Area | Status | Evidence |
| --- | --- | --- |
| Auth | PARTIAL | Email-or-phone/password, session, registration, and recovery behavior pass automated/local browser checks; authenticated staging lifecycle is not verified. |
| Email login | PASS | Email/password path passes automated and local browser tests; no live mailbox was used. |
| Phone login | PASS | Phone/password path passes automated and local browser tests without a Verify.MN request. |
| Email verification | PARTIAL | Token and expiry/replay behavior is automated; live delivery and mailbox click-through were deferred. |
| Phone verification | BLOCKED | Controlled provider tests pass; a real owner-approved test number and observed SMS are missing. |
| Verify.MN | BLOCKED | MO-SMS server-owned polling/session binding is implemented and locally tested; no live provider session was completed. |
| Password reset | PARTIAL | Local token/challenge security tests pass; real email and SMS recovery delivery are untested. |
| Phone change | BLOCKED | Local verification-before-replacement behavior passes; live new-number proof was not performed. |
| Profile | PARTIAL | Account photo privacy/upload/read/delete and security tests pass locally; authenticated staging profile was not inspected. |
| Settings | PARTIAL | Account security controls pass local checks; authenticated staging change/logout walkthrough is missing. |
| Admin | PARTIAL | Authorization and safe recovery actions have backend coverage; authenticated staging admin QA is blocked. |
| User↔Person | PASS | Explicit authorized linking and unrelated-person claim protections have backend regression coverage. |
| Family authorization | PASS | Cross-family backend regressions pass; staging RLS is enabled for all 44 application tables and anon/authenticated table SELECT grants are zero. |
| Minor/guardian permissions | PASS | `test_minor_auth.py` and `test_guardianship.py` cover protected minor access and scoped guardian permissions. |
| Person privacy | PASS | Private Person/profile fields and family-scoped access have backend authorization coverage; no public tree route is allowed. |
| Parent/Child | PASS | Canonical relationship paths and 800-person/799-edge tree rendering regressions pass. |
| Marriage | PASS | Marriage-occurrence history is preserved and rendered in automated tree coverage (90 synthetic occurrences). |
| Divorce | PARTIAL | Automated relationship/history cases exist; no authenticated staging status-change walkthrough was completed. |
| Widowed | PARTIAL | Historical occurrence preservation is covered locally; no authenticated staging walkthrough was completed. |
| Remarriage | PARTIAL | Separate marriage occurrences are represented in local regression; no authenticated staging walkthrough was completed. |
| Adult-added branch | PARTIAL | Root-linking regression covers explicit parent/spouse/descendant paths; complete authenticated adult-add flow was not verified. |
| 2D Tree | PASS | Local browser rendered the 800-person dataset; 2D route and layout regression pass. |
| 3D Tree | PASS | 800-person layout and local canvas/frame checks pass; this is not a production GPU benchmark. |
| Tree navigation | PASS | Root/branch relationship path regression and route checks pass locally. |
| 800-person performance | PASS | Local browser rendered 800 people, 799 parent-child links and 90 marriages on desktop/mobile; API response and UI timings are documented in the prior audit. |
| Family Story | PASS | Family scope, authoring and explicit visibility regression passes. |
| Memories | PASS | Family scope, media and explicit visibility regression passes. |
| Archives | PARTIAL | Family-scoped metadata/access is covered; binary preview capability remains unimplemented. |
| Public content | PARTIAL | Explicitly published content is tested; authenticated cross-account staging visibility is not verified. |
| Private content | PASS | Backend family isolation and private-content authorization tests pass; latest authenticated staging is not inspected. |
| Media | PASS | Private photo authorization and actual encrypted media recovery checks pass. |
| R2 security | PASS | Actual restored private-media routes allowed the authorized principal and denied anonymous access; objects remain private. |
| Database RLS | PASS | Staging RLS is enabled on all 44 app tables; no anon/authenticated table SELECT grants were added. |
| Database backup | PASS | Encrypted staging backup covered all 44 app tables with integrity comparison. Operational provider retention remains open. |
| Database restore | PASS | Isolated restore matched schema and exact row counts/content; 8 authorized reads and 8 anonymous denials passed. |
| Media backup | PASS | R2 workflow exported 3 objects / 775,777 source bytes and verified encrypted artifact integrity. Long-term retention remains open. |
| Media restore | PASS | AES-GCM/RSA-OAEP and checksums verified; 3 restored private-media access checks passed. |
| Accessibility | PASS | 16 targeted keyboard/accessibility checks passed and axe reported zero violations locally; this is not certification. |
| Mobile | PARTIAL | Local route/viewport checks passed at 390×844, 768×1024 and 1440×1000; authenticated staging/mobile was not verified. |
| Security | PARTIAL | Family/privacy/auth regressions and staging RLS pass; live staging security matrix and build-chain advisory decision remain open. |
| Dependency audit | PARTIAL | `braces` was removed from production dependency graph and absent from Worker output; the build-only GHSA remains, and online npm audit is blocked by DNS. |
| Backend tests | PASS | 224 passed, zero skipped; Ruff and Mypy pass; migration cycle/consistency passes on the audited code candidate. |
| Frontend tests | PASS | Clean offline `npm ci`, typecheck, Next build, Vinext build, 25 routes, tree, root-linking and heritage regressions pass after package classification change. |
| CI | PASS | Push run #1180 and PR run #1181 both completed successfully for code commit `bd67b97f174a57bb4a6122ffb77e254b7219fa06`; frontend and backend jobs passed. |
| Staging runtime | PASS | Current guest-only smoke on frontend #54/backend #72: login/register/reset/admin ancestry and health/readiness returned 200; protected shared-lineage/community/family API routes returned 401 anonymously. |
| Authenticated staging | BLOCKED | No safe in-environment authenticated session evidence. External browser capture was rejected by automatic privacy review because it could export private genealogy/account content. |
| Cross-family regression | PARTIAL | Automated backend family-isolation tests and anonymous staging denials pass; two authenticated staging accounts were not tested. |
| Production deployment | NOT TESTED | Explicitly outside authorization; no production action was performed. |

## F. Remaining blockers and owner actions

1. **Live Verify.MN:** provide/approve a disposable test phone and perform verification, phone change, and recovery cases. Evidence still needed: received SMS, successful state transition, and wrong/expired/replay rejection. SMS may incur the documented 150 MNT charge.
2. **Live email:** provide an approved disposable mailbox and verify registration, verification, reset, expiry, reuse and login. Do not use the owner's personal mailbox or change the owner's real credentials.
3. **Authenticated staging:** perform the Admin, Profile, Settings, Tree, content, media, logout and two-family workflows using the owner's own browser or another approved method that does not export private page content. Guest checks pass; authenticated behavior and two-account cross-family access still lack actual staging evidence. The external TinyFish DOM/screenshot path remains rejected by automatic privacy review.
4. **Operational recovery:** configure and evidence provider-native retention, independent key custody, scheduled backups/restores, and a documented recovery procedure. Current one-time isolated restore is not production DR.
5. **Dependency advisory:** upstream lists no patch for CVE-2026-93687. The production graph and deployed Worker are clear of `braces`, but the build-time copy remains. Re-run online `npm audit`; then document owner risk acceptance or revisit when a patched release is available.
6. **Release/production:** complete all staging gates first, then obtain separate explicit human approval before production deployment, DNS, production secrets, or production data operations.

## G. Final decision

`BLOCKED — OWNER ACTION REQUIRED`

Production status remains `NOT READY`. No local or guest-stage PASS is used as a substitute for live contact tests, authenticated staging, or operational disaster recovery evidence.

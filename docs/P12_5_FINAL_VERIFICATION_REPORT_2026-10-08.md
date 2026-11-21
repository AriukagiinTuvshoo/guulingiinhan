# P12.5 FINAL VERIFICATION REPORT

Date: 2026-10-08, Asia/Tokyo. **Production decision: NO-GO.**

Authenticated staging read flows were exercised with the owner's existing browser session. [Sanitized browser evidence](P12_5_AUTHENTICATED_BROWSER.json) records the individual cases. This report separates direct staging evidence, local/CI evidence, unavailable checks and owner-deferred delivery tests. A successful build or a 100% staging rollout does not establish 100% production readiness.

Evidence labels: **VERIFIED** = direct evidence, with its environment stated; **UNVERIFIED** = not exercised or unavailable; **DEFERRED** = intentionally postponed by the owner. No production deployment, production data change or PR merge was performed.

## 1. Deployment identity

Branch: `codex/integration-regression-2026-10-02`.

At the start, checkout HEAD was documentation commit `7b447a464bec2932af24eae9793d1667428e676e`. The frontend/backend build records were re-read and both active applications were confirmed to come from P12.4 source `4d1fc222c07f594953b253b041cd411fda4077e6`; newer documentation builds were skipped.

P12.5 application commits:

- `a6aa47e690b5938e5f4f7882863fc049ffcdb1d5`: common API private/no-store policy, Cookie variance and Cloudflare query redaction.
- `48bcd8868ddaf737c5da55ea8d7bc99e26528d9a`: accurate image/context loading states, photo-request cancellation and narrow viewport width correction.

**VERIFIED — both staging builds completed successfully from `48bcd88` and both versions received 100% traffic.**

| Service | Active version | Active deployment |
| --- | --- | --- |
| Frontend | `72283f38-28b1-45f8-9ecc-28bda396b7d1` | `d49ff819-2d72-4d7d-8545-1ac29c50ad86` after rollback rehearsal |
| Backend | `61b01230-c0c1-4fc0-ba2b-730b2667ead2` | `c30c670d-3130-4941-a7de-8f38195330b3` |

Frontend build: `00122df8-26f6-4adc-b167-3c7ee861b892`. Backend build: `cb282855-7df0-48ea-8f17-f36ad479e74d`. Exact deployment/rollback records: [release evidence](P12_5_RELEASE_EVIDENCE.json).

Staging frontend: [Guulingiinhan](https://guulingiinhan-staging.tuvshoo0331.workers.dev). Staging API: [readiness](https://guulingiinhan-backend-staging.tuvshoo0331.workers.dev/health/ready).

## 2. Authentication

| Check | Evidence / result |
| --- | --- |
| Existing authenticated session | **VERIFIED, staging**: Family A content, two profiles, private Story, Memory photos and Root Admin loaded. Session persisted across tab recreation and page refresh. |
| Logout and later private-page navigation | **VERIFIED, staging**: logout redirected to Login; opening the private Memory again also redirected to Login without its content. The QA browser is signed out at the end. Live replay of an old token is **UNVERIFIED**; no browser cookie was extracted. |
| Malformed email/password and registration body | **VERIFIED, staging**: HTTP 422, safe message; submitted invalid email is not echoed. This is validation, not a completed registration. |
| Email availability | **VERIFIED, staging public configuration**: enabled=true. SMTP binding names exist; secret values were not read. |
| Phone availability | **VERIFIED, staging public configuration**: enabled=true, password login/registration=true, verification provider=Verify.MN. This supersedes older reports that described phone delivery as disabled. |
| Real email/SMS delivery, valid OTP and reset completion | **DEFERRED — owner decision**. No delivery, correct code, replay or mailbox reset success is claimed. |
| Fresh email/phone password login, wrong password and duplicate registration in staging | **UNVERIFIED**. Existing session proves access, not the initial login method. Local/CI identity tests passed. |
| Google | **VERIFIED configuration**: enabled=false. Live OIDC flow **UNVERIFIED**; it was not enabled for this gate. |

Source/local tests verify random session tokens stored as hashes, seven-day expiration, scrypt password hashing, one-use expiring hashed email tokens, purpose/phone/challenge-bound OTP, cooldown/attempt limits and reset/session invalidation. Hosted cookie configuration is Secure, HttpOnly, SameSite=None, Path=/ with no parent Domain. [Public auth configuration and anonymous cookie removal](P12_5_AUTH_CONFIG.json) verify those removal-cookie flags live; they do not establish a fresh login or delivery. Production-host browser behavior remains **UNVERIFIED**. Credential changes require an owner handoff; no password or OTP was requested in chat or logged.

## 3. Family isolation

Aliases **Account A / Family A** are used instead of private names, account addresses or record IDs. The available session has Family owner access and authorized Root Admin access. Live read-only metadata reports **one active Family, three archived Families and seven Persons in the active Family**.

**VERIFIED, staging:** Family A Search, Tree, profiles, Story and Memory reads. Explicit archived-Family Search was denied with no automatic fallback to Family A, no private results and no archived Family title. Global published notices/fund banners remain separate from private Family results.

**VERIFIED, local/CI:** two disposable accounts in different Families; allowed own objects, denied foreign objects, foreign object IDs under an own Family, private media, content references, Admin denial and foreign mutations. The new cache regression also covers own 200, denied 403/404 and revoked-session 401 responses.

**UNVERIFIED, staging:** Account A versus a separate active Family B across every Person/Story/Memory/Archive/relationship/media route. A second authorized account/session and disposable test context were requested but not supplied. An archived-Family denial and local fixtures are not a substitute for that mandatory live matrix.

## 4. Product verification and real root reconciliation

| Flow | Direct authenticated staging evidence | Remaining live checks |
| --- | --- | --- |
| Search | Four sections: 7 People / 1 Story / 3 Memories / 0 Archives; prefix returns 2 People; Memory+2025 returns 1; no-result query returns 0; loading controls and small-result pagination | Active pagination, large dataset and cross-Family B search |
| Relationship Finder | Same Person: 0 steps / generation 0. Existing parent-parent path: 2 steps / generation −2 and common ancestor | Sibling/spouse/former spouse/multiple paths, invalid or restricted targets and no-path cases beyond the local matrix |
| Tree | 7 authorized Persons; Standard/Minimal/Detailed; descendant scope reduces to 2; restore returns 7; zoom, fit and focus; 3D renderer and accessible list loaded | Physical touch/rotate/pan, large live graph, GPU performance and formal visual quality certification |
| Profile / Timeline | Two allowed profiles, family relationships, existing portrait and separate timeline empty states | The two profiles lack dated timeline entries. Full chronology, marriage history and linked-source cases remain live-unverified |
| Story | Private list/detail; editor content retained on reopening, labelled fields, authorized reference search result, cancel without saving | Add/save/reopen/restrict/delete reference target in disposable staging content |
| Memories | Three real entries; private detail with two photos; thumbnails, original lightbox and Escape/focus return | Upload/edit/delete and reference lifecycle in disposable content |
| Archives | Authorized empty state at 320px | Populated archive, document references and write lifecycle |
| Invitations | Invalid code preview safely says material not found and reveals no Family/role/recipient metadata | Owner send, recipient preview/accept, membership, wrong recipient, expiry/revocation and role-escalation matrix |
| Admin | `/admin/ancestry` loads in the authenticated session; manual registration and four-branch controls are present | Live role matrix, removal/archive/restore, approval and mutation audit verification |

The initial Search/relationship/tree/profile/editor checks exercised the actual P12.4 release and first P12.5 hardening build. Final narrow viewport, loading, media and denial checks were repeated against `48bcd88`. No existing Person, Family, relationship, Story, Memory or Archive was edited/deleted to manufacture a passing result.

### Root: reconciliation stopped safely

Requested structure:

```text
Ядамсүрэн + Гүнд
├── Долгор
├── Нансалмаа
├── Баавай
└── Бадамдорж
```

**VERIFIED mismatch:** each of the six owner-supplied names has zero exact canonical matches. A bounded alternative-spelling/prefix check also found zero candidates. The existing root belongs to an active Family, has one canonical child and zero non-deleted marriage occurrences. There is one explicit shared-person membership; approved/pending Root connection counts are zero. The Admin visibly reports the requested four branches as unregistered.

Names alone cannot identify a different existing Person or prove consent. Canonical IDs, intended Family, couple/children mapping and consent cannot be established from these records. **Root writes were stopped; no duplicate people, guessed edges, deletions or automatic publication were performed.** Owner action: identify existing records under other spellings or authorize named manual records in the correct Family with sufficient biographical/consent information. Reuse the existing Admin registration and canonical relationships.

## 5. Media security

**VERIFIED, staging:** authorized private Memory thumbnails and original lightbox; protected original also renders at the API direct URL using the existing browser session. Gallery observations found zero completed broken images and no direct R2 public URLs. R2 media/recovery managed public domains are disabled. No private object was copied to public storage.

**VERIFIED, staging HTTP:** anonymous media endpoint returns 401/private,no-store, including a [known existing original photo URL](P12_5_MEDIA_DENIAL.json), not just a nonexistent fixture ID. **VERIFIED, local/CI:** foreign media, hidden/minor tags, wrong Family, no session, revocation, original/thumbnail and binary recovery checks. Successful media requests use nosniff, restrictive CSP and no-store; the common API boundary now also protects errors and revoked sessions.

Cross-Family B, old-token replay and grant-expiry/revocation in a separate staging recipient session remain **UNVERIFIED**. The browser's direct media navigation after logout reported `ERR_BLOCKED_BY_CLIENT`; the old image document did not supply an HTTP denial observation. It was not counted as a successful revocation test. The independent anonymous HTTP request denied the actual URL, and the private application route returned to Login. Actual upload and secure Story image insertion were not repeated without a designated disposable fixture. Existing public content does not automatically turn its referenced Person or private image into a public asset.

## 6. Minor / guardian privacy

**VERIFIED, local/CI:** independent view_profile/edit_profile/biography/events/memories/media scopes, expired/revoked grants, private intermediaries, minor account restrictions and cross-Family denial. Viewing a profile does not grant event, memory or media management.

Live metadata: four known minors across the staging project, **zero in the active Family**, zero guardianship records. No minor birth dates/names or private content were copied into this report. Real staged guardian, expiry/revocation and role tests are **UNVERIFIED**; archived records were not repurposed as test fixtures. The threshold is the application's 18-year rule, not a legal-compliance certification.

## 7. Performance

[Final public HTTP observations](P12_5_PUBLIC_HTTP.json) are single network-inclusive requests, not authenticated endpoint medians. Final readiness was HTTP 200; protected denials were successful. The first hardening deployment had an approximately 11.8-second readiness observation after rollout; later warm probes were faster. Neither observation alone establishes a container cold-start distribution.

[Readiness timing](P12_5_READINESS_TIMING.json): one warmup + five sequential public samples; median **762ms**, upper sample percentile **778ms**, response **61 bytes**, all HTTP 200. Five samples do not provide a stable population p95. This was measured on the first P12.5 API hardening build, whose backend application code is unchanged in `48bcd88`.

Authenticated People/Search/relationship/Tree/profile/timeline median, p95 and response-byte measurements are **UNVERIFIED**. The browser control surface exposes DOM observations, not an authenticated network timing trace; cookies were not extracted to build a separate client. The live Family has seven Persons; no large live Family is available. The P12.4 800-Person PostgreSQL/local benchmark remains local evidence and is not relabelled as staging performance. Current local 3D layout-only regression positioned 800 Persons/799 parent edges/90 marriages; GPU/network are excluded.

## 8. Mobile

**VERIFIED in a real authenticated desktop browser with viewport overrides:** 390px Tree/Profile/Story editor/Memory/Admin; 320px Archives, invitation and final media/context checks. Drawer opens, Escape closes and focus returns. Photo dialog closes by Escape. Story fields have labels. The real scrollbar exposed a 15px overflow from body min-width=320; it was corrected and final 320px viewport measured clientWidth=scrollWidth=bodyScrollWidth=305.

This is browser viewport testing, **not a physical phone**. Touch gestures, mobile keyboard, safe-area behavior, actual phone login/registration and mobile GPU/memory are **UNVERIFIED**. Prior P12.4 tablet/desktop matrix remains local evidence; no claim of new exhaustive staging checks at every width is made.

## 9. Accessibility

**VERIFIED for tested flows:** named controls, labelled Story form fields, semantic drawer/photo controls, keyboard Escape dismissal and focus return, and separate empty/loading/error messages. Two real loading defects were fixed: original-image loading no longer claims failure; unresolved session/Family metadata no longer claims access denial. Requests remain unauthorised until the scope is actually established.

Full keyboard traversal of every Admin/editor, screen-reader reading order, WCAG contrast audit and a physical-device accessibility audit are **UNVERIFIED**. This is not a blanket accessibility certification.

## 10. Recovery / rollback

**VERIFIED, staging frontend rehearsal:** current `72283f38` → prior secured functional `47715e5e` at 100% → current `72283f38` at 100%. Rollback deployment `a0703232`; restore deployment `d49ff819`. Anonymous login rendered HTTP 200 with Mongolian shell during rehearsal. Cloudflare history confirms both traffic allocations and final current version. Query redaction remains enabled. Backend/data/media were not rolled back.

**VERIFIED, CI on current source:** Alembic upgrade → one-revision downgrade → upgrade → consistency; encrypted media recovery regressions. Earlier P12.3 empty PostgreSQL full downgrade/upgrade and application restore drill are historical/local evidence.

**UNVERIFIED operational gates:** actual native DB backup/PITR retention and last successful backup; scheduled protected DB+R2 backup; portable key custody/second operator; fresh isolated restore of a current backup; restore alerts and agreed RPO/RTO; backend container/image rollback. A Worker rollback does not establish container-image rollback. [Cloudflare rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [container rollouts](https://developers.cloudflare.com/containers/configuration/rollouts/).

The Supabase connector sees the exact healthy staging project, but the available provider Dashboard session sees another organization and cannot open this project's backups. That account's Free plan was not attributed to the staging project. The private recovery bucket's default multipart-abort rule is not backup retention. Prior [recovery runbook](BACKUP_RECOVERY.md) explicitly records that a persistent schedule/deletion policy was not activated. No retention deletion or unapproved schedule was installed. [Supabase backup scope](https://supabase.com/docs/guides/platform/backups).

## 11. Production infrastructure and abuse controls

**VERIFIED staging:** HTTPS workers.dev hosts; exact frontend Origin+credentials CORS; foreign preflight/mutation denied; private storage and database connection readiness; relevant secret-binding names present; docs hidden and safe error bodies. Query strings are redacted in both Workers' settings; source config uses the supported [Cloudflare option](https://developers.cloudflare.com/cf/projects/cloudflare-config/). This does not remove earlier retained logs.

Staging Supabase: ACTIVE_HEALTHY, PostgreSQL 17, schema `d11a6e28f901`. Forty-six application tables have RLS; browser anon/authenticated effective CRUD grants are zero, including on the non-RLS Alembic version table. Advisor findings were empty. This prevents direct browser-role access; FastAPI, not an assumed auth.uid policy, owns Family isolation.

**UNVERIFIED production:** confirmed domain/active zone, production frontend/backend/source, production database/storage/secrets, exact callbacks, CORS/cookies and HTTPS on the intended hosts. Cloudflare shows no Worker custom domains; the sole visible zone is initializing, not activated. A legacy Worker name is not evidence of a ready production stack. No domain ownership was inferred and no DNS was changed.

**VERIFIED source/local abuse controls:** database-backed login/identifier/IP, email reset/verification, phone OTP, invitations, reauthentication, uploads and Memory interactions; challenge cooldown/attempt limit and bounded discovery traversal. Search/relationship and Root request flows lack dedicated request throttles, although graph/result limits apply. Some routine edits and Root/global audit entries need further abuse/request-ID review. No arbitrary new limit was imposed without workload evidence. Live sustained-load/rate-limit behavior is **UNVERIFIED**.

## 12. Exact remaining blockers

| ID / severity | Evidence and exact problem | Required closure / owner action |
| --- | --- | --- |
| GATE-01 High | Mandatory two-account active-Family isolation is live-unverified; one active Family/session available | Supply Account B + Family B session and identify disposable records; run read/write/reference/media matrix with both accounts |
| GATE-02 High | Intended couple/four branches do not match any supplied-name canonical candidates; consent/ID mapping missing | Owner confirms the six records/correct Family/consent or approved manual registrations; operator maps IDs and preserves existing canonical records before linking |
| GATE-03 High | Positive Story/reference write lifecycle, upload lifecycle, invitation acceptance and live role/guardian/token-replay matrices unavailable | Designate disposable staging content/recipient and guardian fixtures; complete save/reopen/restrict/revoke, old-token replay and role tests without changing real records |
| GATE-04 High | Current native backup/portable custody/second-operator restore/alerts/RPO/RTO unverified | Owner supplies access to the correct provider project and key-custody/retention decisions; operator performs isolated database+media restore and missed-backup alert test |
| GATE-05 High | No confirmed production environment/domain and matching host/provider settings verified | Owner confirms exact domain and target production resources; prepare/review a production cutover separately, without deploying from this task |
| GATE-06 Medium | Authenticated staging endpoint distributions and large live dataset not measured; physical device unavailable | Capture sanctioned authenticated network timings and test an authorized large fixture plus actual phone; provide device/trace access |
| GATE-07 High, DEFERRED | Real SMS/email registration/verification/recovery deliverability postponed by owner | When owner resumes this gate, supply dedicated test phone/mailbox and complete delivery, expiry, replay and reset/session tests; keep secrets in provider settings |
| GATE-08 Medium | Backend container rollback, complete screen-reader/contrast and scaled abuse behavior not certified | Rehearse image+Worker rollback in staging, then focused accessibility/load verification; owner chooses alert recipients/workload targets |

No current private-data leak was demonstrated. Missing evidence is still a release blocker; it is not converted into a successful check. GitHub's temporary 500 push failures resolved on retry; source `48bcd88` reached the branch and staging, so that transport problem is not a remaining blocker.

## 13. Final decision and verification summary

**NO-GO for production.** Current staging is usable for the verified authenticated read flows and the P12.5 fixes are deployed. The required cross-Family, real-root, content/role/guardian, operational recovery and production-host gates remain open; delivery gates remain owner-deferred. This cannot honestly be called 100% complete production readiness.

- **VERIFIED local:** full pytest **250 passed**; Ruff across app/tests/migrations/ops; TypeScript/Next build; Cloudflare Vinext build; 27 core route renders; explicit Family-scope regression; 800-node 3D layout regression.
- **VERIFIED remote CI:** [verify run 1199](https://github.com/AriukagiinTuvshoo/guulingiinhan/actions/runs/37702074406), source `48bcd88`; backend/frontend jobs succeeded, including migrations and encrypted media regressions.
- **VERIFIED live public:** 18/18 final HTTP checks, source-identified staging deployments, query redaction and frontend rollback rehearsal.
- **VERIFIED live authenticated:** individual read/UI/media/denial cases described above; no synthetic success is substituted for a missing account.

Early local runs failed because of a wrong working directory, missing/inaccessible pytest temporary parent, Windows SWC sandbox access and an older Next output. The harness was corrected before recording final passing runs. One existing Starlette TestClient deprecation warning remains. No new migration, duplicate genealogy system, authentication rewrite or real root/content mutation was introduced.

## 14. Next focused prompt

> **P12.5.1 — Close remaining authenticated and operational release gates.** Continue from the current integration HEAD and re-confirm application source `48bcd88` (or any later explicitly reviewed successor). Do not redesign the product or deploy production. First obtain a second authorized Account B/Family B session and designated disposable Story/Memory/Archive/recipient/guardian fixtures. Complete the two-account resource/mutation/media/reference and invitation role matrix; preserve private/minor boundaries and record session/grant revocation. Map the owner's six real root records to canonical IDs/Family/couple/children with consent; stop if ambiguous and never create guessed duplicates. Obtain access to the exact staging provider project; verify backup retention/key custody, perform a current isolated DB+R2 restore and alerts, and rehearse backend container+Worker rollback. Capture authenticated median/p95/bytes with a sanctioned trace and test an actual phone. Audit the owner-confirmed production domain/resources/callbacks without deploying. Keep live SMS/email delivery DEFERRED until the owner explicitly resumes it. Return a revised VERIFIED/UNVERIFIED/DEFERRED matrix and GO/CONDITIONAL GO/NO-GO decision backed by artifacts.

**Production was NOT modified.**

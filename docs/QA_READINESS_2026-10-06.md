# Guulingiinhan — readiness audit, 2026-10-06

## Implementation

Branch: `codex/integration-regression-2026-10-02`.

Application commit: `736dd58411c64829566c195b0bd6b4ed14d81a9b`.

### Files changed

- `app/memories/page.tsx`, `app/memories/new/page.tsx`, `components/memories-view.tsx`, `lib/memory-draft.ts`: real creation route, clean form, title/photo validation, explicit family choice, secure existing media API, saved-record recovery after partial uploads.
- `components/app-shell.tsx`, `lib/family-scope.ts`: private routes require explicit authorized family; a foreign ID never falls back to another family.
- `backend/app/admin_workspace.py`, `backend/app/families.py`: audited metadata edit/removal, dependency preview, guarded reversible family archival and restore. Root/shared connections must be reviewed before archival.
- `components/admin-family-studio.tsx`, `components/admin-family-archive.tsx`, `app/admin/page.tsx`: main root/branch context separated from legacy labels, label edit/remove, exact-name archive confirmation, restore controls.
- `backend/tests/test_admin_cleanup.py`, `scripts/verify-heritage-readiness.mjs`, route regression, package script, CI workflow: cleanup preservation, authorization, explicit family scope, creation validation, `/memories/new` route.

### Bugs fixed

`/memories/new` had no page: the dynamic `/memories/[id]` page treated `new` as a UUID and requested a detail record. It now opens a dedicated editor and does not issue that invalid detail request.

The previous ancestry crash was fixed in `1d98881`: the API supplies `workspace.people`; the page incorrectly read `workspace.persons`. The authenticated deployed page now loads successfully.

No new migration. Existing `Family.archived_at` supports reversible cleanup. Staging Alembic revision matches repository head `b10c8e621f4a`.

### Owner-authorized sample cleanup

- Removed three exact `BADAMJAV` / `БАДАМЖАВ` legacy branch labels. Two assignments retain their lineage and have no branch selected.
- Archived the empty test family and the two other sample workspaces; retained the root family `ГУУЛИНГИЙНХАН` as the one active workspace.
- Detached only the two non-root shared-tree projections and marked the sample connection disconnected before archiving. The root couple and external dependent connections were protected by transaction guards.
- Preservation counts before and after the final archive transaction: 24 Persons, 13 canonical parent-child relationships, 5 marriages, 9 accounts, 3 account-person links, 3 stories, 4 memories, 1 photo. No canonical Person, account, relationship, content, or storage object was deleted.
- Family archive is reversible through Admin. Restoring a family does not silently regrant root sharing; reconnect through the existing explicit consent/approval flow.
- Changes were limited to the confirmed staging project and written to the existing audit log. Production was NOT modified.

## QA Matrix

PASS below means the stated checks passed at the stated layer. It does not claim every production provider or every browser/device was tested. The supplied earlier broad report is not treated as current evidence.

| Area | Before | After | Evidence |
| --- | --- | --- | --- |
| Login | Verification gap | PASS | Actual local API/browser login, wrong credentials, reload, logout; backend auth/session tests; staging login route loads |
| Register | Verification gap | PARTIAL | Local form validation and backend registration/verification/duplicate tests pass; staging SMTP enabled, real delivery not exercised |
| Password Reset | Verification gap | PARTIAL | Invalid-token route and backend single-use/expiry/reset/session tests pass; real staging delivery not exercised |
| Home | Verification gap | PASS | Authenticated local route, mobile/tablet layout, no render exception |
| Family | Sample workspaces | PASS | Backend scope tests, archive/restore API; owner-authorized staging cleanup and preservation counts |
| Tree | Verification gap | PASS | Actual local scoped route/mobile layout; canonical/root tests; 800-person layout regression; no renderer rewrite |
| People | Silent default context | PASS | Missing/foreign family makes no private family request; backend privacy/minor/person tests |
| Profile | Verification gap | PASS | Actual private photo upload/read/replace/delete, anonymous denial; account display-name persistence; backend profile authorization |
| Stories | Verification gap | PASS | Cross-family private denial and public story visibility; local route/mobile; backend story/media tests |
| Memories | `/new` resolves to invalid detail | PASS | Empty editor and invalid title/photo validation; actual API creation/photo/detail; partial-upload recovery; authenticated staging new form |
| Archives | Verification gap | PASS | Local route/mobile and existing backend private/public/archive permissions tests |
| Community | Verification gap | PASS | Two-account public story sharing, private memory absent; archived public content hidden; anonymous staging API denied |
| Privacy | Private context defaults | PASS | Missing/foreign scope blocks private calls; cross-family backend 403/404, anonymous 401, existing minor tests |
| Admin | No legacy cleanup/restore | PASS | SUPER_ADMIN cleanup guards; ADMIN/editor/member denied restricted actions; actual archive/restore API; authenticated staging ancestry loads |
| Responsive | Verification gap | PASS | 390×844 and 768×1024 across 11 local authenticated routes, no page overflow or render errors |
| Accessibility | Verification gap | PARTIAL | Form labels, focus, mobile menu Escape, confirmation/cancel, alert associations checked; full contrast/screen-reader audit not performed |

### Automated gates

- Local pytest: **195 passed**. Initial two failures were missing/permission-restricted Windows test folders; complete rerun with a valid isolated base folder passed.
- Ruff: PASS. Typecheck: PASS. Next build: PASS. Cloudflare Vinext build: PASS.
- Route regression: 25 routes PASS. Root paths, 3D layout, family scope and memory validation: PASS.
- [GitHub verify run](https://github.com/AriukagiinTuvshoo/guulingiinhan/actions/runs/37338271722): frontend and backend PASS, including `npm ci`, PostgreSQL upgrade → downgrade one revision → upgrade → Alembic consistency.
- Disposable local real-API/browser scenarios: 9/9 principal scenarios and 7/7 supplemental scenarios PASS. SMTP is replaced with a fake delivery provider only inside the disposable fixture; these results do not prove external delivery.
- Staging public checks: health/readiness HTTP 200; email enabled, phone and Google disabled; five direct routes no generic crash/console render exceptions; four protected anonymous API requests HTTP 401.
- [Authenticated staging check](https://agent.tinyfish.ai/runs/64fd1f7d-49a4-4285-a593-03fd7c42d7fd): Memory new form blank/no early error, correct family, root Admin renders. No test content was created in staging.
- An earlier oversized TinyFish inventory timed out and is not counted as PASS.

## Final Score

- **Implementation completion: 100% (5/5 scoped work packages)**: memory bug, explicit family scope, reversible Admin cleanup, authorized sample cleanup, domain cutover preparation. This is not a claim that production is launched or that all prior product requests are complete.
- **QA verification: 81.25% (13 fully verified areas / 16 matrix areas)**. Three PARTIAL areas are not counted as fully verified.
- **Production readiness: 66.67% (6/9 gates)**. Passed: backend/security tests, frontend/regression/build, healthy staging, key authenticated route verification, safe sample cleanup, domain runbook. Unmet: real provider end-to-end verification including required SMS, backup/isolated restore, actual domain activation/TLS/cutover.

## Remaining Issues

1. **High — production SMS configuration.** Staging `/api/v1/auth/phone/config` returns `enabled:false`. With this configuration, the existing production settings validator refuses startup. Expected: configured real Twilio delivery and passing OTP/expiry/retry/limits checks. Configure provider secrets and verify delivery; do not weaken the production guard. Google is optional and intentionally disabled.
2. **High — database/media recovery evidence.** The connected database organization is on the free plan; paid automatic backup coverage cannot be assumed. No protected export/private-media backup or isolated restore evidence was available. Expected: documented retention, secure storage and successful isolated recovery before real production data. Configure exports/private object backup and exercise the existing restore runbook.
3. **Medium — live register/reset delivery.** SMTP availability is true, but real mail delivery/verification/reset was not exercised against a designated test recipient. Expected: the full provider flow verified without changing the owner's password or creating permanent test accounts. Use an approved test mailbox, clean up only its fixture account, and retain no tokens in logs.
4. **Medium — accessibility completeness.** Practical keyboard/form checks pass; full contrast and screen-reader assessment remains. Expected: the complete matrix passes on production hosts. Perform that focused pass without rewriting the UI.
5. **Pending owner input — domain.** No purchased domain was supplied. Cloudflare has no Worker custom domains, and `site.app` is still initializing. Expected: confirmed owned domain, active zone, matching frontend/API, CORS/email URLs and valid TLS. Follow `CLOUDFLARE_CUSTOM_DOMAIN.md` after purchase; no DNS was changed.

## Production Decision

**NOT READY**

The staging fixes and authorized cleanup are deployed. Production should remain closed until the provider, recovery and domain gates are satisfied. Production deployment, production data, DNS and real account passwords were not modified.

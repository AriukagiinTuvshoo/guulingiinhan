# Domain readiness — browser audit, 2026-10-13

## Result

**PASS — 47/47 actual browser/API acceptance scenarios.** No remaining failure in the requested local browser gates. This is scoped verification, not a claim that every production/domain requirement or physical device has been tested.

The frontend was the existing production `.next` build of Next.js 16.3.8. Each actual API suite started fresh disposable FastAPI, synthetic SQLite and private local media storage at localhost ports 8840/8841, then cleaned up its owned API, frontend and browser processes. No live staging/production data, real email delivery or phone provider was used.

| Actual browser → API suite | Passed | Evidence timestamp (UTC) | Evidence |
| --- | ---: | --- | --- |
| Integrated flows | 20/20 | 2026-10-13T05:45:31.014Z | `INTEGRATED_BROWSER_QA.json` |
| Mobile/admin/PWA | 19/19 | 2026-10-13T05:49:21.051Z | `MOBILE_ADMIN_QA.json` |
| Onboarding/invitation/linking | 8/8 | 2026-10-13T05:50:24.779Z | `ONBOARDING_BROWSER_QA.json` |

Successful application responses in these three suites came from the real API, not response mocks. Mobile/admin deliberately aborted three initial admin identity requests and one pending-summary request, and delayed one genuine directory response to verify failure/retry and stale-row behavior. These faults are recorded in its JSON scope.

## Verified behavior

- Real password login, logout invalidation and ordinary/SUPER_ADMIN/admin role boundaries; administrative directory denied to ordinary members while authorized contextual family reading and own profile editing remain available.
- Root couple and four canonical branches; personal family tree excludes unrelated root records. Child/spouse proposals, duplicate protection, approval, rejection, withdrawal and safe detach retain canonical people/relationships as required.
- Profile editing, protected portrait upload/read/delete, account portrait persistence and dashboard/header byte consistency, including inherited account-photo fallback and mobile MIME handling.
- Actual memory image upload, private preview, rich-text story image insertion, archive persistence, public/private content/media visibility, cross-family denial, family/public funds, event registration/cancellation, published notifications and draft exclusion.
- Mobile header account/bell controls, navigation, popover bounds, Escape and touch targets at 320/375/390/768/1024/1440px; family/shared tree header overrides at 320/390/768px. Admin navigation at 320/390/768/1440px.
- Direct admin section URLs, persistent People/ancestry navigation, localized initial identity failure and successful Retry for admin overview/People/ancestry, pending-count unknown states and readonly directory query rows cleared before the new response arrives.
- Atomic new-account onboarding, stable repeated requests without orphan family/person, invitation membership without inferred Person identity, recipient restrictions, explicit existing-person reuse, private-person transfer denial, pending claims surviving reload and owner approval.
- Actual tree existing-parent search and selection UI creates the relationship; reciprocal API tree reads and visible parent are verified.
- Chromium manifest/installability checks return no installability errors; real PNG icon dimensions 192/512; activated network-only worker does not put private page/API/media content in CacheStorage. Offline private navigation returns a generic 503 fallback rather than cached private content.

Normal browser flows produced no unexpected JavaScript errors or API 5xx responses in these gates.

## Supplemental rendering and companion checks

| Check | Actual result | Scope/limit |
| --- | --- | --- |
| `verify-family-map-browser.mjs` | PASS, 9 responsive widths and semantic/focus/list/back-state interactions | Synthetic API responses; rendering proof only |
| `verify-shared-tree-browser.mjs` | PASS, 320/390/768/1440px plus child/spouse/cancel/Escape/bell/fund interactions | Synthetic API responses; not backend authorization proof |
| `verify-pwa.mjs` | PASS | Worker/manifest source simulation; actual Chromium worker/privacy also covered above |
| `verify-image-upload.mjs` | PASS | Five MIME/filename transport variants, invalid/empty/size rejection and honest HEIC fallback against local HTTP |
| `verify-family-map.mjs` | PASS | Canonical projection, marriage occurrences, endpoint filtering, safe disconnected layout, bounded focus/window up to 5000 synthetic people; algorithm test, not production capacity |
| `verify-tree-3d-layout.mjs` | PASS | Positions 800 synthetic people/799 parent-child edges/90 marriages; algorithm test, not real-device GPU rendering |

The rendering harnesses intercept only the explicit synthetic API origins (`ci.invalid` or localhost8840), reuse the same compiled UI and do not contact private staging data. Their separate JSON evidence is `FAMILY_MAP_BROWSER_QA.json` and `SHARED_TREE_BROWSER_QA.json`.

## Findings and repairs to the verification harness

1. A Windows cold fixture start exceeded the old 30-second harness deadline before any acceptance scenario ran. A bounded 90-second unbuffered Python diagnostic produced a fresh fixture manifest and HTTP 200 health response. The three suites now use `python -u` and a 90-second startup bound, retaining fresh nonce/timestamp/health validation. They subsequently completed. This was an environment/startup deadline issue; no product failure was hidden or labelled fixed.
2. The integrated harness used an obsolete exact notification nav label. The admin now appends a descriptive subtitle. The selector was scoped to the real admin navigation and its existing label prefix; the same notification assertions pass.
3. The mobile harness expected `/people` to redirect. Current policy intentionally provides a member/own-profile page. Its assertion now verifies that actual page and own-profile link, while retaining administrative API 403 and self-edit checks.
4. A synthetic global ADMIN gained membership only in Family B to exercise its legitimate readonly directory. Family A isolation and restricted-role assertions remain unchanged. This fixture adjustment does not grant global administrative access to private family data.

No application source, real user data, Git commit or deployment was changed by this browser audit. Application fixes were owned by the coordinating frontend/backend agents; the new retry, query and navigation regression checks above verify their compiled behavior.

## Reproduction commands

Use the final production UI build and the known working local Python runtime through `QA_PYTHON` if required. Run sequentially because the three actual API suites own ports 8840/8841:

```powershell
node scripts/verify-integrated-browser.mjs
node scripts/verify-mobile-admin.mjs
node scripts/verify-onboarding-browser.mjs
node scripts/verify-family-map-browser.mjs
node scripts/verify-shared-tree-browser.mjs
node scripts/verify-pwa.mjs
node --experimental-strip-types scripts/verify-image-upload.mjs
node scripts/verify-family-map.mjs
node scripts/verify-tree-3d-layout.mjs
```

## Limits and release handoff

- Physical iOS/Android installation, Safari behavior and native OS installation prompts were not verified. Responsive Chromium and installability are verified; they are not substitutes for a physical-device install.
- SQLite/local storage browser tests do not prove PostgreSQL/RLS, real SMTP, Cloudflare routing, DNS/TLS, recovery or production capacity. Those gates have separate coordinator evidence.
- The compiled `.next` UI used here predates the coordinator's final HTTP security-header configuration change. These browser results verify UI/API flows, not deployment of those last headers; hosted post-deploy header checks remain the coordinator's responsibility.
- No staging/production mutation or real phone/email test occurred in these suites. Invitation delivery uses a disposable fake provider and ignored local mailbox; credentials/tokens are excluded from evidence.
- No browser gate blocker remains. Domain connection and production release status must be determined from the coordinator's deployment, infrastructure and provider evidence.

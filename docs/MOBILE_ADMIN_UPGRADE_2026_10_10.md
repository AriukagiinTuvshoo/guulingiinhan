# Mobile + installable app + admin upgrade

## Implemented

- Mobile/tablet header: profile and notification bell retain44px touch targets; family context occupies its own row. Corrected shared/family tree header overrides and bounded navigation drawer to the dynamic viewport.
- Account menu, notifications and navigation avoid overlapping open states. Notification panel has explicit close and keyboard Escape support; read-state copy distinguishes read announcements from an empty feed.
- Installable PWA manifest,192/512px PNG and maskable icons, Apple icon, standalone metadata and install action. Chromium uses its native installation prompt when offered; otherwise platform instructions are shown, including iPhone Add to Home Screen.
- Network-only service worker. No private HTML, API, portraits, photographs or account data stored in Cache Storage/IndexedDB. Offline navigation renders a generic connection message only.
- Admin layout uses supplied ZIP as a visual reference: grouped forest navigation, ivory workspace, overview statistics, pending requests, recent audit, shortcuts and current-page search. All values/actions use existing authorized APIs; no reference demo backend/data copied.
- Existing roles, destructive confirmations, canonical genealogy, database schema and private media policies preserved.

## Verification

- Typecheck and Next production build PASS.
- Cloudflare/Vinext build PASS; final deployment build verifies the final commit.
- Route regression27/27 PASS.
- PWA static asset/network/privacy checks PASS (`npm run test:pwa`).
- Real API mobile/admin browser suite **14/14 PASS** (`npm run test:mobile-admin`). Disposable synthetic local records only; no live mutations.
- AppShell widths320/375/390/768/1024/1440; admin navigation320/390/768/1440; personal/shared tree controls320/390/768.
- Profile/bell44px targets, containment/nonoverlap, settings navigation, notification/drawer Escape, responsive overflow, request loading/error/retry, actual manifest/icon dimensions and Chromium installability errors0.
- Worker registration/control, generic offline fallback and zero private cache entries verified. Browser JS exceptions0 and unexpected API5xx0.

Evidence: [MOBILE_ADMIN_QA.json](./MOBILE_ADMIN_QA.json). Local screenshots are under `.integrated-qa/mobile-admin-*.png`, use synthetic data only.

## Reference and limits

The supplied Arena preview URL returned "Preview Unavailable" outside Arena. The ZIP contained complete admin component/styles; these informed the implementation without replacing real authentication/APIs with its demonstration backend.

Native installation on a physical Android/iPhone device was not performed. The install control and actual Chromium installability criteria are verified; browser platform determines when its native install prompt appears. iPhone users follow Share → Add to Home Screen. Notification bell is in-app, not newly implemented background push.

Production and real family data were not modified. Staging release identifiers and post-release verification are recorded separately after rollout.

# Mobile portraits and people administration closure — 2026-10-10

Branch: `codex/integration-regression-2026-10-02`. Baseline: `ac013a3a0d85a8e4f982a24dafe985d67cc7bdaa`.

## Changes

- Reviewed PhotoPicker/AdminShell suggestions from the requested Arena agent `01a11b13-38d5-7918-ab4d-5fa4c660a466`; integrated selected suggestions into the current branch. No stale Arena branch merge.
- Accessible branded photo picker, filename and preview; actual-byte MIME normalization for JPEG/PNG/WebP mobile exports. Browser-supported HEIC conversion only, with explicit unsupported-device guidance. Backend validation and metadata stripping retained.
- Scoped photo change events refresh account header and canonical featured portraits separately.
- Fixed actual featured-person JSON serialization: the previously undeclared photo field was dropped from the API response. A declared response model now returns the authorized private photo URL.
- People administration moved to `/admin/people`. Ordinary app navigation no longer exposes the directory. Adult profile writes require self linkage or SUPER_ADMIN; existing explicit guardian protections remain.
- Shared admin navigation persists on overview, people and root management. Added own-profile shortcut and keyboard skip link. Removed standalone ancestry back header and ordinary profile lineage write form.
- Restored existing admin featured-person control. Contextual `/persons`, search and tree reads retain existing family privacy. Dashboard count uses the contextual endpoint, avoiding a newly restricted directory request.

## Verified

- Backend full suite: 312/312 PASS before the final featured serialization repair.
- Final portrait, featured privacy and person policy regression: 15/15 PASS after that repair. Ruff PASS.
- Next production build and TypeScript PASS on final frontend source.
- Cloudflare/Vinext build PASS before the last small dashboard/profile copy and form cleanup; exact final source is rebuilt by staging deployment.
- Core route regression: 27 PASS; new admin people navigation is covered by authenticated browser scenarios.
- Image normalization regression PASS: five MIME/name variants plus invalid, empty, oversize and unsupported HEIC rejection.
- Final authenticated localhost browser → actual API → disposable SQLite: **17/17 PASS**, widths 320, 375, 390, 768, 1024, 1440. Evidence: `MOBILE_ADMIN_QA.json`.
- Upload → featured API → dashboard portrait, mounted portrait refresh, account photo → header refresh, role gates, own edit, persistent admin routes, loading/error count, PWA installability/offline privacy, no uncaught JS/API 5xx verified.

One deliberately aborted local admin request tests unavailable count handling. Normal scenarios use actual APIs, not mocked responses. Fixtures and image files are disposable, synthetic and ignored by Git.

## Limits

No universal HEIC compatibility or physical iPhone Safari test is claimed. The actual OS install dialog is not claimed; Chromium manifest/installability and network-only worker privacy were checked. Account and genealogy photos intentionally remain separate. No production data or deployment changes.

Staging deployment and exact-commit CI results are reported after publication in the final response.

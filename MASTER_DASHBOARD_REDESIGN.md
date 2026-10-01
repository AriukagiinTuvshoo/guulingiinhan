# MASTER V2 dashboard redesign

Baseline: 030db4fda4964e7f64637afb85944ca904db259b (main at task start).
Branch: feature/master-dashboard-redesign.
Source version deployed to staging: f45f656df3e3bb68773c4c2be3e30740c167413a.
Acceptance: the requested frontend redesign is live on the staging Worker. The broader spec still has explicit dependency limits: main has no reusable 3D renderer or Activity/Event/Fund APIs, and the backend Ruff gate reports a pre-existing import-order error.

## V2 design and data behavior

The original and V2 prompts share the same real-data, forest-green family heritage dashboard direction. V2 calls for a more premium, unmistakable visual transformation. The update strengthens the forest hero with antique-gold detail, turns the real API totals into an editorial forest-green band, frames story and featured-person content in warm sage and ivory, and corrects narrow-screen Mongolian word wrapping. It does not invent people, statistics, memories, relationships, events or funds.

- The existing App Shell remains the only navigation and family-switcher owner. Its loaded user/family context is exposed through a small React context; the dashboard does not repeat those requests.
- An explicit invalid family is rejected without selecting another family. Dashboard children are keyed by the requested family; requests are aborted on unmount, and results from aborted requests are discarded.
- Five independent bounded requests load /families/{id}/people?page=1&page_size=6, /tree?depth=2, /stories?page=1&page_size=4, /memories?page=1&page_size=6, and /archives?page=1&page_size=3.
- People, story, memory and archive totals come from the paginated API totals. No generation count is inferred. Tree sample counts are labeled as a summary, not a full-family total.
- Featured Person is an actual visible record. It is not labeled as the lineage ancestor. Profile links use canonical Person.id and Family.id.
- Story feature and timeline share one request. Timeline dates use actual event_date values, never record creation dates as historical events.
- Album reads the paginated memory response and uses authenticated family photo endpoints, lazy images and an error fallback. Arbitrary third-party private photo URLs are not loaded.
- Archive remains metadata-only. Owner/editor actions are hidden for members; backend authorization remains authoritative.
- Settings Google-link form uses the guarded API_BASE export; there is no production localhost fallback.
- The Cloudflare frontend target is separately configured for the existing guulingiinhan-staging Worker. Its public API base is the staging backend. No backend Worker, database, migration, auth or secret was changed.

## Real dependency limits

PR #92 was open and unmerged when inspected. Main has no reusable 3D renderer or test:tree-3d script. The task prohibits copying that implementation or merging its branch. The dashboard tree overview therefore draws only actual returned parent/child and marriage links and links to the existing Tree page. It does not claim to provide an interactive 3D renderer, rotation, zoom, selection or reset.

Main has no family Activity, upcoming Family Event, or Family Fund endpoints. Those sections are omitted instead of fabricating records or zero values.

## Cloudflare staging deployment

- Target Worker: guulingiinhan-staging.
- URL: https://guulingiinhan-staging.tuvshoo0331.workers.dev
- Deployment ID: 36d2e499-2822-409b-b185-e4814e63fa5b.
- Active version: 0838c43e-97ed-43c8-88c2-4b62b445e4af, receiving 100% of Worker traffic at 2026-10-01 12:01:15 UTC.
- Previous version 773e1fcd-8658-4c7e-b151-9f57fecb4176 remains in deployment history for rollback.
- Live smoke checks: /login returned HTTP 200; the deployed V2 stylesheet returned HTTP 200 and included the heritage hero, forest color and tree node styles.
- The authenticated private family dashboard was not browsed, so live private records, real photos and account-specific page rendering remain unverified.
- Cloudflare automatic PR preview checks fail for guulingiinhan, guulingiinhan-backend-staging and guulingiinhanback because those configured Worker preview targets do not exist or are different services. This does not change the direct deployment result for guulingiinhan-staging.
- Vercel project guulingiinhan-a6te produced a ready preview. The unrelated Vercel guulingiinhan production status failed; no production deployment was performed.

## Validation

- npm ci: PASS, 0 reported vulnerabilities.
- npm run typecheck: PASS.
- npm run build: PASS.
- git diff --check: PASS.
- npm run test:tree-3d: unavailable on the main baseline.
- npm ci after adding the Cloudflare OpenNext adapter and staging deploy script: PASS, 0 reported vulnerabilities.
- npm run cf:build:staging: PASS. OpenNext produced the Worker bundle; it warns that Windows is not its recommended build host.
- npm run deploy:staging -- --dry-run: PASS; resolved guulingiinhan-staging and its ASSETS binding.
- npm run deploy:staging -- --strict: PASS; staging deployment completed.
- Local Workers runtime /login: HTTP 200.
- Backend CI pytest: 144 passed with one Starlette deprecation warning.
- Backend CI Ruff: FAIL on existing I001 import ordering at backend/tests/test_invitation_uniqueness.py:1. No backend file was changed in this task.
- Responsive screenshots checked at desktop, tablet and 390px mobile widths. Mobile document width stayed within its viewport and Mongolian headings wrap by whole words.
- Browser QA used a separate loopback fixture API with synthetic records kept outside the repository. No fixture data was sent to staging or production.
- 320, 375, 390, 430, 768, 1024, 1280 and 1440px: no horizontal document overflow.
- Family switch isolation, invalid family, member actions, error recovery, loading, failed photos and keyboard focus were checked against the separate fixture.
- Reduced motion has a scoped CSS override. Full screen reader and real-device GPU performance were not verified.

This staging update is not a production release. No merge or auto-merge was performed.
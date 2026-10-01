# MASTER Dashboard redesign

Baseline: `030db4fda4964e7f64637afb85944ca904db259b` (current main at start).
Branch: `feature/master-dashboard-redesign`.
Overall acceptance: **BLOCKED** on the existing 3D renderer dependency and the full CI gate. This is a reviewable main-based frontend implementation, not a claim of complete 3D delivery.

## Data and behavior

- The existing App Shell remains the only navigation/family switcher owner. Its loaded user/family context is exposed through a small React context; the dashboard does not repeat those requests.
- An explicit invalid family is rejected without selecting another family. Dashboard children are keyed by the requested family; requests are aborted on unmount, and results from aborted requests are discarded.
- Five independent bounded requests load `/families/{id}/people?page=1&page_size=6`, `/tree?depth=2`, `/stories?page=1&page_size=4`, `/memories?page=1&page_size=6`, and `/archives?page=1&page_size=3`.
- People, story, memory and archive totals come from the corresponding paginated API totals. No generation count is inferred. Tree sample counts are explicitly labeled as a summary, not a full-family total.
- Featured Person is a real visible record with a biography among the first six directory results, or the first visible record. It is not labeled as the lineage ancestor. Every profile link uses Person.id and Family.id.
- Story feature and timeline share one request. The timeline uses only actual `event_date` values from the returned story sample, never record creation dates as historical events.
- Album reads the actual paginated memory response (the old dashboard incorrectly assumed an array). It uses authenticated family photo endpoints, lazy images, and an error fallback. Portraits accept family-scoped API photo paths; other URLs use initials. No arbitrary third-party private photo URL is loaded.
- Archive remains metadata-only. Owner/editor creation links are hidden for members; memory creation remains available according to the existing API policy. Backend authorization remains authoritative.
- Settings Google-link form now uses the guarded API_BASE export; there is no production localhost fallback.

## Deliberate dependency limits

PR #92 was open/unmerged when inspected. Main has no reusable 3D renderer or `test:tree-3d` script. The task expressly prohibits copying that implementation or merging its branch. This branch therefore includes an honest real-data Tree overview and navigation to the existing Tree page, not a replacement renderer or a claimed interactive 3D preview. Rotation, zoom, selection and reset integration remain blocked until that renderer is available on main.

Main has no family Activity, upcoming Family Event, or Family Fund endpoints. Those sections are omitted, rather than representing unavailable data as zero activity/events/funds. No backend, schema, migration, auth or deployment configuration changes are included.

## Validation

- `npm ci`: PASS, 0 reported vulnerabilities.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `npm run test:tree-3d`: BLOCKED: main does not define this script.
- `git diff --check`: PASS.
- `uv run pytest`: 142 passed, 2 setup errors caused by Windows access to the shared pytest temporary directory. Re-running exactly those two tests with an isolated `--basetemp` passed both (144 tested successfully across the runs).
- `uv run ruff check app tests migrations`: FAIL on pre-existing I001 in `backend/tests/test_invitation_uniqueness.py:1`. Backend files are unchanged.

Browser QA used a separate loopback fixture API with explicitly labeled synthetic test records, stored outside the repository. No fixture data is bundled or written to staging/production.

- 320, 375, 390, 430, 768, 1024, 1280 and 1440px: no horizontal document overflow.
- Visual inspection: 390x844, 768x1024 and 1440x900.
- Family A to B switch: old person absent; all dashboard family links target B.
- Member role: only the allowed memory creation action remains.
- Explicit unauthorized family: safe error, no family hero, no fallback URL.
- Stories failure: hero, person and archive remain rendered; retry restores both story and timeline.
- Slow response: six skeleton/busy sections, without replacing the loaded hero.
- Photo error: graceful fallback instead of a broken image.
- Keyboard Tab: visible solid focus outline; one main h1; canonical person links inspected.
- Reduced motion has a scoped CSS override. Full screen reader and real-device GPU performance are not verified.

Live authenticated data, real image cropping, Vercel preview and production browser acceptance are not claimed by the local fixture checks. No deployment or merge is performed by this task.

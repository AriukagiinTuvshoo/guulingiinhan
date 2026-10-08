# Arena reference family-tree redesign

Date: 2026-10-08. Branch: `codex/integration-regression-2026-10-02`.

## Reference and implementation

The owner explicitly requested the two Arena designs and identified Option B as the family-tree direction. The Arena conversation and both rendered previews were inspected. Option B's source archive was downloaded through Arena's source download control and read as reference material. Its circular portraits, spouse connectors, branching descendants, forest backdrop, map controls and detail-panel composition were adapted to the existing application.

The reference's demo graph, browser-local genealogy store, fake sample reset, bulk-clear and local undo actions were not integrated. Existing Family/Person identities, marriage occurrences, parent-child edges, secure ProfilePhoto delivery, backend authorization and server mutation flows remain the application source of truth.

## Changes

- `lib/family-map-layout.ts`: deterministic household layout, independent component frames, canonical SVG parent/spouse paths, iterative subtree placement and viewport selection capped at 240 person nodes. Unknown endpoints are excluded. Remarriage never duplicates a person.
- `components/family-map.tsx`: circular portraits; Overview, Focus and paginated List; pointer pan, two-pointer pinch, wheel pan/Ctrl zoom, keyboard navigation, fit/center controls, generation navigation, semantic density and visible ancestor/descendant paths. Camera state is restored from the URL.
- `app/family-map.css`: forest/gold/ivory map, landscape silhouettes, responsive composition, touch controls and person drawer. Mobile uses a bottom sheet; desktop uses a side sheet. Reduced-motion styles are respected.
- `app/tree/page.tsx`: cleaner heading, secondary actions in one menu, existing authorized search, live person editor/relationship actions, accessible detail-sheet focus/close, relative selection, URL camera persistence and Profile/Back integration. Existing 3D mode and print remain available.
- `components/app-shell.tsx` and `components/shared-donation-banner.tsx`: on the tree route, published news/fund information is compact and expands on demand. The mobile tree header is one row and retains navigation, family selection and account controls.

## Local verification

All timing figures below are local synthetic algorithm measurements, excluding API, network, images and GPU rendering.

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `NEXT_PUBLIC_API_BASE_URL=https://ci.invalid/api/v1 npm run build` | PASS; 31 generated pages |
| `npm run test:family-map` | PASS: 20, 30, 100, 800, 2000, 5000 people; unique identity, no same-row overlaps, marriage statuses, disconnected components, unknown-endpoint filtering, bounded focus and viewport |
| `npm run test:family-map-browser` | PASS: 320, 360, 375, 390, 414, 430, 768, 1024, 1440px; contained pan canvas, no page overflow, real connectors, readable framing, sheet, drag, list, 800-person window, search/focus and Profile/Back |
| `npm run test:tree-3d` | PASS: 800 people, 799 parent-child edges, 90 marriages; median layout 23.93ms |
| `npm run test:heritage` | PASS |
| `npm run regression:routes` | PASS: 27 routes |
| `git diff --check` | PASS |

Latest map projection plus layout measurements: 800 people 26.22ms; 2000 people 53.53ms; 5000 people 152.53ms. Responsive browser measurements are in `FAMILY_MAP_BROWSER_QA.json`. Screenshots use disposable synthetic API responses and are kept locally in the ignored `.family-map-artifacts` directory.

## Staging

First rollout: application commit `3e1c210`, Worker version `b14e1d29-099a-426b-a6cd-8f34980d038d`, at `https://guulingiinhan-staging.tuvshoo0331.workers.dev`.

Authenticated owner session: VERIFIED that the new map loaded authorized real records, an existing portrait loaded through secure media delivery, a person tap opened the detail sheet, the founding couple and four children were connected correctly, family editor controls remained available and Focus showed the six-person founding household. No record was created, changed or deleted. Live inspection identified clipped long-name labels and excessive vertical whitespace for independent households; both were corrected before the final rollout.

Authenticated Profile/Back: VERIFIED that the authorized profile opened and Back retained selected person, Focus mode and camera parameters. A transient API connection failure occurred during the concurrent rollout; reload recovered the session, and frontend/API health both returned 200. This is recorded rather than counted as uninterrupted navigation success. At 390px, real founder/child names and all six canonical records loaded. Live QA found that camera coordinates from a different viewport size needed re-framing; camera state now includes viewport dimensions and the browser regression checks phone-to-desktop re-framing.

Final staging deployment identity and the last smoke result are recorded below after rollout. Production was not modified. No database mutation or migration is part of this task.

## Boundaries

Physical-device gesture behavior and a separate live Account A/Account B matrix are not inferred from desktop emulation. Existing API limits still bound server-loaded graphs. The 5000-person check verifies the presentation algorithm, not a 5000-person production API round trip.

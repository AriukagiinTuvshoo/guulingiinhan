# Guulingiinhan: main baseline audit

Baseline: `030db4fda4964e7f64637afb85944ca904db259b` (`main`). The Cloudflare staging branch and open PR #91 are separate and are not included in this baseline.

| Requirement | Existing implementation on main | Status | Evidence | Action |
| --- | --- | --- | --- | --- |
| User ↔ Person | `UserPersonLink` is unique per account and Person; a Person created by the user can be linked directly, while an existing Person requires a Family owner to approve the claim. | PASS | `backend/app/families.py`, `backend/tests/test_person_link_claims.py`, `app/tree/page.tsx` | Keep owner identity review; no automatic name-based linking. |
| Father's/mother's branch | Canonical parent-child edges and Lineage/Branch assignment exist; UI navigation exposes assigned Branch and actual parent/child context. | PASS | `backend/app/models.py`, `backend/app/families.py`, `app/tree/page.tsx`, `components/tree-3d-scene.tsx` | No inferred paternal/maternal labels where the domain does not record them. |
| Multi-generation navigation | Tree traversal, relationship-derived generation navigation, search and focus are capped at depth 5 and 800 people per response. | PARTIAL | `backend/app/families.py` tree endpoint, `app/tree/page.tsx`, `components/tree-3d-scene.tsx` | Continue through search/focus; 800 is a safety cap, not an unlimited whole-lineage response. |
| Self profile editing | Linked adult can edit Person profile, biography and life events; account identity is separate. | EXISTS | `backend/app/families.py`, `app/profile/page.tsx` | Reuse; verify privacy in tests. |
| Account settings | Identity list, display name, phone linking, password recovery, family selection, profile privacy and current-session logout exist. Email change, account avatar and session list are not implemented. | PARTIAL | `backend/app/auth.py`, `app/settings/page.tsx`, `app/account/security/page.tsx` | Do not expose unsupported controls. |
| Admin relationship management | Family owner can review Person link claims and manage canonical family relationships; duplicate resolution and global admin are not implemented. | PARTIAL | `backend/app/families.py`, `backend/tests/test_person_link_claims.py`, `app/tree/page.tsx` | Keep review family-scoped; global admin remains separate work. |
| Donation/family fund | No fund or donation existed on baseline. | PASS | `backend/app/family_activities.py`, `FamilyFund`, `Donation`, migration `d7a2f1b893c4`, `/activities` | Family owner manages funds; member reports transfers; owner manually confirms. |
| Family events | `LifeEvent` is an individual's biography; separate gathering model was missing. | PASS | `FamilyEvent`, `EventRegistration`, `/activities` | Separate family event, registration, deadline and capacity. |
| Event payment | No payment domain/provider existed. | PARTIAL | `backend/app/family_activities.py`, tests | Bank/QR instructions and manual reported → confirmed flow; no gateway. |
| PWA | Responsive pages existed; install metadata, worker and icons were absent. | PASS | `app/manifest.ts`, `public/sw.js`, `public/icon-192.png`, `public/icon-512.png`, `backend/tests/test_pwa_contract.py` | Cache allowlist covers only public home and static icons. |
| Home | Public Home and authenticated dashboard exist. | EXISTS | `app/page.tsx`, `app/dashboard/page.tsx` | Preserve and add links only for real modules. |
| Canonical family root | Baseline had no Family root designation; tree used the current linked Person or an arbitrary visible Person as traversal root. | PASS | `Family.root_person_id`, `PUT /families/{id}/root`, `e3b82c41a7d0` | Nullable pointer to a real existing Person; owner selects later; root cannot be detached until cleared. |
| 3D tree visualization | Three.js is client-only, batches node and relationship rendering, and retains 2D/search/list alternatives. Local browser smoke covered WebGL rendering, rotate, zoom and selection. | PARTIAL | `components/tree-3d-scene.tsx`, `lib/tree-3d-layout.ts`, `npm run test:tree-3d` | Mobile/WebGL fallback and automated browser coverage remain incomplete. |
| 700–800 person performance | Tree API limit is 800 people and 1,200 edges; branch and generation layout are adaptive; isolated synthetic layout benchmark covers 800 nodes. | PARTIAL | `backend/app/families.py`, `backend/tests/test_search_tree_scale.py`, `scripts/verify-tree-3d-layout.mjs` | 800-node browser/GPU render, real API payload latency and mobile performance are not yet measured. |

## Architecture and infrastructure

The schema maintains separate `User`, `Person`, `Family`, `Lineage`, `Branch`, relationship, story, memory, archive and photo entities. Family membership and guardian scopes enforce private access. Registration and password recovery use authentication identities and do not create a Person; onboarding can create one by explicit choice. This branch adds `person_link_requests`, `family_funds`, `donations`, `family_events`, `event_registrations`, and nullable `families.root_person_id`, ending at migration `e3b82c41a7d0`.

Main has a Next.js frontend, FastAPI backend, PostgreSQL-oriented CI with upgrade/downgrade checks, Vercel entrypoint tests and a Dockerfile. It has no Cloudflare Worker configuration. The Cloudflare staging implementation lives on another branch; this work does not merge it. `ARCHITECTURE.md` and `DATABASE.md` are reconciled with this branch's model and migration evidence.

The production tree visualization is client-only Three.js, loaded dynamically so server rendering does not require WebGL. It reuses `/families/{id}/tree`, `/families/{id}/persons/search`, existing person directory/lineage/branch endpoints, canonical root and relationship identifiers. The tree response is capped at 800 people and 1,200 edges; see the architecture note for the synthetic layout benchmark scope.

## Security finding

The baseline `link-me` endpoint checked family membership and uniqueness but did not verify that a target existing Person belonged to the requesting account. The implementation now permits direct linking only for an eligible Person created by the current user; an existing Person requires a pending claim and family-owner approval. URL parameters remain selectors, never authorization.

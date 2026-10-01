# Guulingiinhan: main baseline audit

Baseline: `030db4fda4964e7f64637afb85944ca904db259b` (`main`). The Cloudflare staging branch and open PR #91 are separate and are not included in this baseline.

| Requirement | Existing implementation on main | Status | Evidence | Action |
| --- | --- | --- | --- | --- |
| User ↔ Person | `UserPersonLink` is unique per account and Person; onboarding creates and links a Person. Any family member can currently claim an unrelated unlinked Person. | PARTIAL | `backend/app/models.py`, `backend/app/families.py` `link-me`, `app/onboarding/page.tsx` | Require owner review for an existing Person, retain direct link for a Person created by the account. |
| Father's/mother's branch | Canonical parent-child edges and Lineage/Branch assignment exist; no dedicated paternal/maternal navigation. | PARTIAL | `backend/app/models.py`, `backend/app/families.py`, `app/tree/page.tsx` | Improve navigation using existing IDs and edges. |
| Multi-generation navigation | Bounded tree traversal, search, focus and depth controls exist; a request is capped for performance. | PARTIAL | `backend/app/families.py` tree endpoint, `app/tree/page.tsx` | Preserve limits and allow continued focus-based traversal. |
| Self profile editing | Linked adult can edit Person profile, biography and life events; account identity is separate. | EXISTS | `backend/app/families.py`, `app/profile/page.tsx` | Reuse; verify privacy in tests. |
| Account settings | Identity list, phone linking, password recovery and security view exist. Account avatar, display-name and email-change UI are absent. | PARTIAL | `backend/app/auth.py`, `app/settings/page.tsx`, `app/account/security/page.tsx` | Add only safely supported changes. |
| Admin relationship management | Family owner/editor can manage relationships; no owner-reviewed account claim, duplicate-resolution flow or global admin on main. | PARTIAL | `backend/app/families.py`; no `backend/app/admin.py` on main | Extend existing family-owner workflow first. |
| Donation/family fund | No fund or donation existed on baseline. | PASS | `backend/app/family_activities.py`, `FamilyFund`, `Donation`, migration `d7a2f1b893c4`, `/activities` | Family owner manages funds; member reports transfers; owner manually confirms. |
| Family events | `LifeEvent` is an individual's biography; separate gathering model was missing. | PASS | `FamilyEvent`, `EventRegistration`, `/activities` | Separate family event, registration, deadline and capacity. |
| Event payment | No payment domain/provider existed. | PARTIAL | `backend/app/family_activities.py`, tests | Bank/QR instructions and manual reported → confirmed flow; no gateway. |
| PWA | Responsive pages existed; install metadata, worker and icons were absent. | PASS | `app/manifest.ts`, `public/sw.js`, `public/icon-192.png`, `public/icon-512.png`, `backend/tests/test_pwa_contract.py` | Cache allowlist covers only public home and static icons. |
| Home | Public Home and authenticated dashboard exist. | EXISTS | `app/page.tsx`, `app/dashboard/page.tsx` | Preserve and add links only for real modules. |
| Canonical family root | Baseline had no Family root designation; tree used the current linked Person or an arbitrary visible Person as traversal root. | PASS | `Family.root_person_id`, `PUT /families/{id}/root`, `e3b82c41a7d0` | Nullable pointer to a real existing Person; owner selects later; root cannot be detached until cleared. |

## Architecture and infrastructure

The schema maintains separate `User`, `Person`, `Family`, `Lineage`, `Branch`, relationship, story, memory, archive and photo entities. Family membership and guardian scopes enforce private access. Registration and password recovery use authentication identities and do not create a Person; onboarding can create one by explicit choice. This branch adds `person_link_requests`, `family_funds`, `donations`, `family_events`, `event_registrations`, and nullable `families.root_person_id`, ending at migration `e3b82c41a7d0`.

Main has a Next.js frontend, FastAPI backend, PostgreSQL-oriented CI with upgrade/downgrade checks, Vercel entrypoint tests and a Dockerfile. It has no Cloudflare Worker configuration. The Cloudflare staging implementation lives on another branch; this work does not merge it. `ARCHITECTURE.md` and `DATABASE.md` are reconciled with this branch's model and migration evidence.

## Security finding

The baseline `link-me` endpoint checked family membership and uniqueness but did not verify that a target existing Person belonged to the requesting account. The implementation now permits direct linking only for an eligible Person created by the current user; an existing Person requires a pending claim and family-owner approval. URL parameters remain selectors, never authorization.

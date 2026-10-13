# Domain readiness: focused frontend audit — 2026-10-13

## Scope and evidence

Reviewed the current integration branch from baseline `d69228f`: admin routes/navigation,
family members and own-person setup, tree permissions, account/person photographs,
story rendering, modal focus handling, mobile shell controls, install manifest and service worker.
Existing release notes and the untracked local database were preserved.

This document records source review and focused static verification. The parent audit
owns Next/Vinext builds and broad regressions; the QA agent owns rendered browser checks.
No production resources, real family data, secrets, backend policies or migrations were changed here.
Real phone/SMS-provider verification is excluded from this pass.

## Confirmed defects and repairs

| Area | Confirmed cause | Repair |
| --- | --- | --- |
| Admin navigation | Shared navigation generates `/admin?section=...`, but AdminPage initially always selected overview and never read the query | Validate the initial query and browser popstate against existing section names; preserve local detail/studio navigation |
| Admin initial load | A failed initial identity/overview request had no recovery action | Add bounded retry state and rerun the original authorized read requests; permission denials retain their distinct message |
| Admin list reads | Clicking the current menu again cleared an error without retriggering the list effect | Add explicit retry for existing users/families/admins/audit list sections |
| Admin People initial load | The visible Retry changed a revision counter that the identity request did not observe | Retry also reruns `/admin/me`, before any family-directory request is authorized |
| Admin People directory | A query/page change left the prior rows visible until the 240 ms debounce expired; one loading state was shared with the independent family selector request | Immediately clear prior directory rows and use a dedicated directory loading state, retaining abort/cleanup protection |
| Standalone root admin load | A network/server failure was presented as missing admin privilege, with no recovery action | Distinguish 403 from load failures and retry the existing `/admin/me` request |
| Install guidance | The close control's declared target was only 32×32 px | Increase the control to 44×44 px |

Repairs retain the original API endpoints, role restrictions, family isolation,
search bounds, destructive-action confirmations and genealogy architecture.

## Source-review findings

### Navigation and authorization

- Admin, root management and admin People share AdminShell; root/audit/rights navigation is restricted to SUPER_ADMIN.
- Admin People first reads `/admin/me`; arbitrary editing reuses existing SUPER_ADMIN workspace endpoints.
- Ordinary `/people` is family-scoped members/self-linking, not the global administrative directory.
- Own-person requests use the existing owner-reviewed claim flow. Member cards only link a visible authorized `person_id` returned by the backend.
- Tree profile editing reads `PersonProfile.can_edit_profile`, separately from owner/editor relationship controls. Opening the editor rechecks the fresh response.
- Invitation acceptance points to the accepted family and own-person setup rather than creating another family implicitly.
- Admin self-profile shortcut targets the existing `settings#account` section.

### Photos, rich content and browser storage

- Protected photo requests use credentials only for relative API paths, `cache: no-store`, and `referrerPolicy: no-referrer`.
- Object URLs and in-flight requests are revoked/aborted during component cleanup.
- Image preparation validates actual signatures, enforces 10 MB, handles supported mobile HEIC conversion, and returns localized conversion failures.
- Account-photo and canonical person-photo change events are scoped by endpoint; root portraits do not publish account-photo events.
- StoryContent renders text as React nodes and permits only explicit HTTPS links with `noopener noreferrer`; no raw HTML injection was found in the reviewed renderer.
- Source search found no token/password persistence in localStorage/sessionStorage and no `dangerouslySetInnerHTML` in app/components/lib.
- `lib/api.ts` uses the configured public API base; localhost fallback is conditional on development. No staging worker URLs were found hardcoded in reviewed frontend routes/components.

### Mobile, accessibility and installation

- Root layout declares viewport fit and the mobile shell uses safe-area insets.
- Mobile account and notification controls remain 44×44 px; bounded fixed panels permit internal scrolling.
- Admin navigation is keyboard-accessible and horizontally scrollable at small widths; AdminShell has a skip link and focusable target.
- `useDialogFocus` traps tab focus, supports Escape, restores the trigger, and restores body overflow on cleanup.
- The manifest uses relative URLs, standalone display, and existing 192/512/maskable icons.
- The service worker is network-only for same-origin navigations. It does not use Cache Storage or IndexedDB and returns a generic no-store offline page; private family data is not persisted offline by this worker.
- Install buttons consume a native install prompt when supplied, otherwise show platform guidance. Availability of a browser's native prompt and actual iOS/Android installation remain device/browser-dependent; source review is not evidence of a physical-device installation.

## Focused checks performed

- `node node_modules/typescript/bin/tsc --noEmit`: PASS after TSX repairs.
- `git diff --check` on the modified admin frontend files: PASS.
- Manual source review of endpoint gates, debounce/abort cleanup, PWA storage behavior,
  safe content rendering and route anchors: completed.

## Verification limits

Actual rendered mobile layout, interrupted-request recovery, installation gestures,
cross-role responses and complete browser → API behavior must be reported from the
parent's current browser QA evidence. This static audit does not label unexecuted
browser checks, domain DNS/TLS, deployment or real-provider delivery as PASS.

## Changed files in this audit

- `app/admin/page.tsx`
- `app/admin/people/page.tsx`
- `components/admin-shell.tsx`
- `app/mobile-shell.css`
- This report

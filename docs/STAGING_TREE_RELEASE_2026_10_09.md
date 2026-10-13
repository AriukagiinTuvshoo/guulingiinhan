# Staging tree release — 2026-10-09

Base: `9521ac478777f4477de9f20422798fe99c214047`, branch `codex/integration-regression-2026-10-02`.

## Changes

- Main ancestry and personal family branch use the same interactive FamilyMap: spouses beside each other, children below, pan, pinch, zoom and list modes.
- Connected shared people have child/spouse request actions. Disconnected cards are omitted from the main tree.
- Independent per-person requests support pending approval, rejection, cancellation and safe projection detachment. Approval rechecks identity, consent, family access, minor protection, cycles, parent count and spouse conflicts.
- Legacy and family relationship APIs cannot bypass review of the rooted shared graph. Private family editing and consent withdrawal remain available.
- Personal tree requests use the account-linked family branch; unrelated root branches do not enter this view.
- Admin can upload sanitized portraits through private storage. Shared portraits require public visibility and current shared-tree authorization on every authenticated read.
- Profile-adjacent notification bell replaces the announcement strip; unread state and optional sound are browser preferences. Donation account remains visible in the compact tree banner.
- Singleton family selection and profile-to-family-tree links corrected.

## Verification actually performed

- Full backend suite: 290 passed. Final additional shared-tree/relationship guard suite: 48 passed.
- Ruff passed; configured mypy passed for all 34 backend source files using the installed pure Python implementation.
- Typecheck, Next production build and Cloudflare/Vinext staging build passed.
- Route regression: 27 routes passed. Family map, root linking, heritage and 3D layout checks passed.
- Local headless Edge family map QA: 9 widths (320–1440), focus/list/search/pointer/navigation-state checks passed.
- Local headless Edge shared tree QA: 320/390/768/1440, child/spouse pending requests, cancellation, Escape, bell and donation passed. Fixtures never reached a real API.
- Both additive schema revisions applied atomically to staging: `f6c2a9104b37`, then `a72d9e410c8b`. Postflight confirmed the request table empty, RLS enabled, no anon/authenticated read privilege, and existing private backend role write privilege.
- New request migration upgrade/downgrade/upgrade/consistency checked locally. Staging migration preserved canonical people and relationships.

Build success alone does not establish authenticated staging behavior. Deployment IDs and live QA are recorded after rollout.

Production was not modified.

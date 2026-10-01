# Staging integration baseline (2026-10-02)

This branch starts at `main` commit `030db4fda4964e7f64637afb85944ca904db259b` and combines the reviewed staging, #93 and compatible #92 changes. Work on new pages should branch from this integration branch until it is merged to `main`. The two staging Workers must use this same branch and commit.

| Area | Source commit(s) | Integration decision |
| --- | --- | --- |
| Login, staging email/phone mode and authentication | `035dee0`, `f89c6ba`, `238dc6a` | Keep staging auth and backend provider behavior. |
| Family context and dashboard base | `969963a`, `4429fa7`, `12739e0` | Keep the authenticated family context. |
| Premium dashboard | #93 `80213ea`, `f45f656` | Restore the heritage dashboard and its scoped CSS. |
| Global admin roles and panel | `e167b34`, `bd64368`, `d7d17ee` | Keep staging admin security and panel. |
| Tree relationship edit and detach | `8ec6f45`, #93 `2306807`, `6964a93` | Keep the backend corrections and current 2D editor. |
| 3D tree | #92 `ed1f309`, `5341eac` | Restore as an optional view without replacing the 2D editor. |
| Private person profile/photo | `d7d17ee` | Keep staging R2-backed profile implementation. |
| Account name and privacy settings | #92 `5341eac` | Restore the compatible account edit and settings UI while retaining staging auth checks. |
| Family fund and gatherings | #92 `9fccf21` | Restore the feature; rebase its additive migration after staging head `f71a2c5d90e1`. |

The original #92 migrations for `person_link_requests` and `families.root_person_id` cannot be merged as-is: staging migration `a31e6d7f42c0` already creates those structures. The original #92 auth module also predates staging's minor-login and cookie safeguards. These duplicate migrations and the older auth module are intentionally excluded; the corresponding staging functionality remains present.

The original #93 OpenNext files were excluded because this repo's staging frontend uses Vinext. Keeping both deploy adapters would let a build use the wrong Worker configuration.

## Regression gate

The `verify` workflow now builds both Next and Vinext, checks TypeScript, opens the core routes, exercises the 3D layout, runs backend tests and Ruff, and upgrades/downgrades the database schema. The backend suite includes creation, correction and removal of tree relationships and person detach. A green workflow is required before staging deployment. Cloudflare's two staging build triggers must include only this integration branch so an old PR branch cannot overwrite it.

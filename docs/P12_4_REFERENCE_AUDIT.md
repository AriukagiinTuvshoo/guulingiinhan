# P12.4 reference audit — 2026-10-07

Baseline: `codex/integration-regression-2026-10-02`, HEAD `4bb870a6c6a0c9fb4717b81defe138a75cb018a0`. The checkout also contains P12.1–P12.3 changes, which must be preserved.

## Current feature matrix

| Feature | Existing / quality | ZIP equivalent | Reuse | Action |
|---|---|---|---|---|
| Auth, Family permissions, guardian scopes | Server enforced, established | Fake client auth | D | Preserve |
| Person / parent-child / marriage | Canonical relational graph, cycle lock, separate marriage occurrences | Nested static tree, spouse string | D | Preserve |
| Search | Paginated per resource; prefix Person search | In-memory filtering | C | Unified permission-filtered endpoint and UI |
| Relationship finder | Canonical edges available, no user finder | Idea only; no calculation implementation | C | Cycle-safe bounded graph traversal |
| Tree | 2D/3D, zoom, fit, focus, close/full; 1,000 node cap | Static SVG tidy tree | B/C | Display density, branch focus, print; retain graph layouts |
| Profile / timeline | Profile, biography, events, marriages and content references; separate lists | No actual profile/timeline page | C | Merge authorized canonical dates chronologically |
| Stories | Rich Markdown, protected photo tokens, Person/date/place/visibility | Suggestions only | C | Authorized resource links, editorial context |
| Memories / Archives | Existing secure uploads, Person tags, dated content | Mock archive list | B/C | Cross-links through existing text storage and controlled resolution |
| Invitations | Owner-only, hashed token, recipient-bound, expiration/revocation | No secure implementation | D/C | Improve current confirmation and guidance |
| UI / mobile | Existing forest/ivory/gold tokens, shell, focus trap, mobile polish | Reusable visual patterns | B | Scoped primitives, labels, compact filters and states |
| Themes | No existing theme architecture; extensive heritage styles | Demo localStorage toggle | C | Retain existing tokens; do not introduce second theme system |
| Print | No dedicated current tree print | Idea only | C | Authorized current tree print layout |

## ZIP inventory and decisions

34 entries, 348,117 uncompressed bytes. Extracted with path/traversal/symlink/size checks; reference code and package scripts were not executed. No backend, migrations, permission layer, secure storage, license or README supplied.

| ZIP item | Decision | Reason / planned use |
|---|---|---|
| `src/components/ui.tsx` | B | Label/error association, empty/skeleton patterns. Adapt to existing styles. CopyButton reports success before clipboard resolves; password score counts regex objects rather than matches: do not copy those defects. |
| `src/components/AppShell.tsx` | C/D | Compact header/mobile navigation ideas; retain current sole shell. Demo drawer lacks focus trap, metrics/user are static. |
| `src/data/tree.ts`, `pages/TreePage.tsx` | B/C/D | Density, node selection and curved link ideas. Layout accepts nested trees only, cannot represent multiple parents/remarriage/cycles; repeated node lookup is quadratic, parentId is not populated by recursion. Keep existing canonical layout. SVG buttons lack keyboard activation and fit resets a fixed transform. |
| `pages/MembersPage.tsx`, `pages/DocsPage.tsx` | B/C | Compact type/filter/result layout. Filtering is over imported demo arrays, no authorization or pagination. Archive actions/OCR/upload are placeholders. |
| `pages/DashboardPage.tsx`, `components/charts.tsx` | C/D | Visual hierarchy only. Static metrics/activity are not usable data; new analytics excluded from scope. |
| `pages/EventsPage.tsx` | D | In-memory RSVP, no server writes; new RSVP excluded. |
| `pages/LoginPage.tsx`, `lib/auth.tsx` | D | Fake sign-in/registration/recovery/social buttons and demo credentials. No real session or security. |
| `lib/router.ts`, `App.tsx`, `main.tsx` | D | Hash router silently falls back to dashboard; incompatible with explicit Family routing. |
| `lib/theme.tsx` | C | System preference concept only; unchecked storage values and additional theme architecture unnecessary. |
| `lib/format.ts`, `utils/cn.ts` | A candidate / C | Pure formatting/class composition possible, but existing helpers suffice. Relative time hardcodes June 2026: rejected. No dependency added. |
| `lib/icons.tsx` | C | Existing Lucide icons retained; no duplicate icon library. |
| `data/clan.ts`, static tree/archives | D | Demo people, minors, credentials, counts and ancestry do not enter application data. |
| `data/ideas.ts`, `pages/IdeasPage.tsx` | C | 44 proposed ideas, prioritization and design notes, not shipped functionality. Current scope selects search/finder/density/timeline/print; OCR/DNA/offline/RSVP etc remain future. |
| `pages/DesignPage.tsx`, `index.css` | B/C | Responsive type, restrained borders, semantic states, reduced motion and spacing concepts. Existing font/color tokens retained, no wholesale Tailwind/CSS copy. |
| `package*.json`, `index.html`, `tsconfig.json`, `vite.config.ts` | D | Vite/singlefile/demo dependency foundation incompatible with Next/Vinext/FastAPI. Do not install or run. |

Classification precedes product implementation. No direct copying is needed: valuable items are adapted patterns or ideas. The ZIP contains no relationship algorithm, unified server search, timeline builder, real media system, virtualization or security tests.

## Additional reference: `web-project-improvement-ideas (1).zip`

Added by the owner during implementation. 27 entries, 23 files; same package/lock/toolchain as the first ZIP, different source application. Safely extracted to a separate directory without executing code. This is a single-page proposal/showcase, not an authenticated product implementation. Its static audit claims, conversion metrics, timing targets and user demographics are not evidence about this repository or live staging.

| Item | Decision | Integration / reason |
|---|---|---|
| App, Nav, Footer, Hero | C/D | Single-page showcase navigation/static tree and people; current App Shell remains owner. Hero's linear tidy-tree handles one parent only; synthetic sequential IDs cannot replace canonical graph. |
| Screens/ProfileScreen | B/C | Timeline date rail and restrained metadata adapted to `person-timeline.tsx`. All demonstrated people/events remain excluded. |
| DesignLab, index.css | B/C | Compact controls, forest/paper/brass, readable text hierarchy. Do not copy tiny 6–10px mock text or replace existing typography. |
| Ideas, Quadrant, Roadmap, Targets | C | Proposal prioritization only. Checklist localStorage is not release evidence or application data; no new analytics/command palette/offline scope. |
| Audit / data.content findings | C | Unverified snapshot/claims, including assumed empty SSR. Actual route regression and browser measurements decide status. |
| CodeLab SSR snippet | D | Public cache headers are unsafe for our private pages; undefined metadata/skeleton helpers; existing Next/Vinext renderer retained. |
| CodeLab D1 schema / recursive CTE | D | Second people/edges database, no Family/guardian filtering, recursive UNION ALL without cycle bound, marriage conflated with parent-child. |
| CodeLab Hono RBAC/invitation | D | Incompatible roles/storage, client-chosen role lacks ceiling, ID vs generated-token mismatch, unfinished delivery helpers. Keep existing hashed, recipient-bound invitations. |
| CodeLab GEDCOM / matching / OCR-AI | D for this scope | Future explicitly excluded. Parser/matching incomplete; no automatic person reconciliation or outside processing of private media. |
| Reveal | C | IntersectionObserver idea; do not hide functional content before hydration or introduce decorative animation. Existing reduced-motion handling retained. |
| utils/highlight | A candidate / not needed | Escapes text before syntax display; useful for code showcase only, no application need and no new HTML injection surface. |
| index.html / build configuration / shared utils | C/D | Showcase-only SEO/static metadata and Vite build. No production platform changes or dependency installation. |

Additional ZIP adds no working unified search, authorized relationship calculation, protected media API, real profile model, invitations or server tests. Its useful timeline/layout ideas augment the same P12.4 work; no separate product was created.

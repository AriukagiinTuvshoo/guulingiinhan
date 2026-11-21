# P10.5 genealogy and administration contract

## One identity and one source of relationships

`Person` is the canonical person identity. `ParentChildRelationship` and `Marriage` are canonical family facts. `FamilyPerson` defines which family can see and manage a person. A family tree reads these records; detaching a person from a family removes that family's membership and content tags, not the person or canonical relationships.

`SharedAncestry` names the account-wide root. `SharedAncestryPerson` is an explicit visibility grant. `RootConnection` records a family's request, consent, review state, target parent, and the canonical edge used by an approved connection. Disconnecting changes projection status and retains the canonical edge. A person is shown in the common tree only when the visibility, adult, and consent checks pass. Private family content never becomes public through a root connection.

`SharedAncestryRelationship` is legacy projection compatibility. New root links write canonical `ParentChildRelationship`; legacy rows can be removed from the root projection without changing family genealogy. The root admin list now identifies each edge's source. Canonical corrections have a separate super-admin action with an explicit typed confirmation and audit event; approved root connections must be disconnected first.

`Lineage`, `Branch`, and `PersonLineageAssignment` are family-scoped administrative labels retained for existing data. They are **not** a second ancestry graph, do not determine generations, and do not control root or family edges. A branch in the shared tree is a path through canonical parent-child edges from the shared root, and a family's entry point is its approved `RootConnection`. Household is a presentation grouping, never an inferred genealogy fact. The future 2D and 3D views must consume the same person and edge contract; neither should infer a parent from a label, surname, coordinate, or generation number.

## Admin permissions and sensitive actions

`SUPER_ADMIN` can review root requests, change the root, edit canonical genealogy, detach a person from a family, and manage global donation information. Ordinary `ADMIN` can access only routes guarded by `require_admin` or `require_operator`; it cannot use family workspace or shared lineage mutation endpoints. Family owners and members use their family routes and cannot call system admin routes. Every sensitive mutation records an `AuditLog` action with actor and target.

Before a person is detached, the admin can inspect linked account, parent-child and marriage counts, family story, memory and archive tags, shared root involvement, root connections, and pending claims. Detach is blocked for an account-linked person, family or shared root, shared person, active root connection, or pending claim. The UI explains that family tags are removed while person, canonical facts, content records, and other families remain. Canonical relationship deletion is deliberately a separate action with its own warning.

## Deployment and verification

This P10.5 change needs no schema migration: it reuses existing models and routes. Staging must run backend tests, frontend typecheck/build, route regression, 3D regression, and migration check. Production is outside this phase. Authenticated mobile and account-to-account staging QA remains a separate release gate; CI alone does not prove it.

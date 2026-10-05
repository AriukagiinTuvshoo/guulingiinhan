# Family tree and shared root connection

The Family tree is the local, membership protected view of canonical `Person`,
`ParentChildRelationship`, and marriage records. The shared root is a consented
projection of those same people and relationships. A Person is never copied to
make a branch. A household is presentation of existing relationships, not a new
identity or authorization boundary.

`RootConnection` records an explicit Family anchor request: the linked account's
Person, the chosen existing shared root Person, the asserted relationship type,
consent time, requester, decision, and canonical relationship ID. A super admin
reviews the request. Approval creates the canonical parent-child edge only when
one does not already exist. It never infers a link from a name, date, gender,
place, or generation. A retry of the same pending request is idempotent.

The Family remains the authorization boundary for stories, memories, archives,
photos, and the local tree. Shared root reads include only consented,
non-private adult people and the permitted lineage fields. Dates in the shared
projection are year-only; exact profile dates and photos stay inside existing
authorized profile routes. Root connection does
not grant access to another Family workspace.

Disconnect changes only the shared projection status. The Person, canonical
relationship, Family tree, and historical content remain. For a Family anchor,
the shared tree displays its cross-Family edge only while that Family connection
is approved for the selected target. Existing legacy shared relationships are
read for compatibility, but new join and placement writes cannot create another
competing shared genealogy edge.

User path: Family tree → Connect to root → select own linked Person → select
an existing reachable root Person → choose supported parent-child type → consent
and request → super admin review → connected view. A rejected or disconnected
request can be resubmitted. Root and Family pages both link back to the local
tree. No automatic Family connection occurs after creating a Person or local
relationship.

## Guided ancestor administration (P10.8)

`/admin/ancestry` offers manual Person entry without an account, a root-couple
confirmation, four named first-branch guides, and one Person → relationship →
preview workflow. The names supplied by the owner are registration guidance;
they never select records or create relationships automatically. The family
workspace remains the canonical source of Person data.

Super Admin writes:

- `PUT /admin/shared-lineage/root-couple` explicitly establishes two existing,
  eligible People and their canonical Marriage atomically. Both must belong to
  the selected active Family. A stale expected root is rejected; prior People
  and relationships are preserved when the root changes.
- `POST /admin/shared-lineage/connect-person` publishes an eligible non-account
  Person and their explicit child or spouse relationship in one transaction.
  The selected parent/spouse must be reachable through approved root links.
  A second parent is optional and must have a registered spouse relationship
  to the first parent. Existing compatible parent edges can be reused; duplicate
  submissions and conflicting relationship types are rejected.
- `DELETE /admin/shared-lineage/people/{person_id}` removes shared visibility
  and legacy projection links only. Person, Family, canonical parent-child and
  Marriage records, UserPersonLink, stories, memories and archives remain.
  Root ancestors are protected. Any corresponding account connection is marked
  disconnected and requires a new explicit request to reconnect.

Private/minor People are excluded. Living People require the existing public
visibility policy; account-linked People require their own consented request.
Only Super Admin can make these writes. ADMIN, MODERATOR and family roles are
rejected. Cycles, ancestor/spouse conflicts, duplicate marriages, self links
and more than two parents are checked by the backend. Shared dates remain
year-only. No schema migration, account creation or name-based relationship
inference is introduced.

The common frontend path helper derives branch context from visible canonical
parent-child and spouse links. An unconnected or pending account Person has no
root path merely because its account link exists. `npm run test:root-linking`
checks these path rules; backend regression tests exercise the named root
couple, four children, a grandchild, spouse links, privacy, permissions and
safe detachment in an isolated database.

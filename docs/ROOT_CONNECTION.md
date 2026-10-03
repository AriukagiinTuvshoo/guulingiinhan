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

# New member, invitation and canonical identity closure

## Confirmed failure

The old `/onboarding` client committed a family, then a new Person, then called
`link-me`. A user with an existing `UserPersonLink` received 409 at the last step,
leaving a partial family and a duplicate candidate. The generic error incorrectly
described this as family creation failure. `/people` also redirected to Admin
People, making the ordinary tree's self-registration guidance a dead end.

## Product flow

1. Accept a verified recipient's invitation to join the existing family.
2. Open **Гишүүд ба миний бүртгэл**, without entering global administration.
3. Claim an existing authorized Person through owner approval, or register only
   the current account's own Person in the selected family.
4. Reuse an existing canonical identity only with explicit consent. Invitation
   acceptance by itself never establishes identity, parenthood or spouse links.
5. An authorized family owner/editor selects existing people in the tree to
   record an explicit parent/child/spouse edge. Both views read that same edge.

The account, Person, family membership and kinship remain separate concepts.
The public ancestry tree remains consent filtered. No global private directory,
name-based matching, bulk graph merge, private archive transfer or role escalation
is introduced. Private and minor records remain protected.

## Arena

The authorized Battle conversation received one synthetic-only prototype request:
https://arena.ai/c/01a1237e-1e00-704c-8469-6a3c0cfe7a27

It compared an invitation-first guided wizard with a family workspace. The useful
direction is a guided invitee setup plus a family member roster for owners.
Prototype scores and simulated consent are not production verification. Arena's
stale coding branch was not merged and no runtime family data was supplied.

## Existing boundaries

- Ordinary members can register/claim their own identity, but parent/spouse writes
  still require the existing owner/editor role. No ordinary kinship-request API
  is claimed.
- Cross-family ancestry publication uses the existing reviewed shared-root flow;
  connecting identities does not grant access to another family's archive.
- Previously created partial families are not silently deleted or merged.
- Native phone testing and real external invitation delivery are separate from
  disposable browser tests.

## Verification and deployment

- Next.js production build and TypeScript: PASS.
- Core route regression: 27/27 PASS.
- Browser → actual FastAPI → disposable SQLite: 8/8 PASS, including real
  invitation issuance through the fake email provider, verified acceptance,
  pending claim reload/owner approval, existing parent selection in the tree,
  reciprocal relationship projection, and cross-family/admin denial.
  See `ONBOARDING_BROWSER_QA.json`. No browser JS errors or API 5xx occurred.
- Backend full local run: 325 passed; one minor-account test expected 403
  although existing authentication correctly rejects that session with 401.
  The assertion was corrected without changing authentication. The final
  focused run passed all 32 onboarding/invitation compatibility tests,
  including two abandoned-claim recovery cases added after the full run.
- Ruff: PASS. Configured mypy: PASS, 35 source files.
- No schema migration or real family record changes are required.

The reviewed source is intended for both existing Cloudflare staging Workers.
Exact deployed revision and hosted CI results are confirmed in the completion
report. Production deployment is outside this change.

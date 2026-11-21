# Own profile avatar follow-up — 2026-10-10

The user's screenshot demonstrated a gap in the previous release: the own genealogy portrait changed, but the application header still displayed the separately stored account image.

The header now resolves only the authenticated user's linked canonical person within the authorized current family. That person's portrait takes precedence over the account fallback. Matching person upload/delete events refresh the header, and normal loading restores the correct portrait after navigation or reload. Viewing or editing another person never selects that person's image as the signed-in avatar. Requests are aborted on scope change/unmount; state is keyed by user and family/person identity. Existing private photo endpoints, authorization and separate storage are unchanged.

Account photo help explains its fallback role. No existing photos or other live records are modified by this change.

## Verification

- Next build and final TypeScript typecheck PASS.
- Authenticated localhost browser → real API → disposable database: 17/17 PASS.
- The test starts with a different, old account photo. It compares actual rendered header image bytes to the authorized own portrait after UI upload, replacement, reload and navigation to another person. Account upload cannot replace an existing own portrait. Own portrait removal correctly falls back to the account image.
- Two distinct synthetic images ensure an old but successfully rendered avatar cannot falsely pass the assertion.
- No production deployment/data change. Staging publication is verified separately.

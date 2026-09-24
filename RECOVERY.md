# P4.12 — Production Backup, Restore & Disaster Recovery

## Status boundary

P4.12 is intentionally narrow and safe. It adds a read-only storage consistency checker, a synthetic recovery fixture, and the recovery runbook. It does not configure a cloud backup provider, restore production, or add a database migration.

P4.11 PR #2 is still open. This branch is based directly on P4.11 commit `e9dc80404d260d27647acc7c3cda0dade36f6629`.

## Verified repository facts

- Production database vendor: **NOT VERIFIED FROM REPOSITORY**.
- Production object-storage vendor: **NOT VERIFIED FROM REPOSITORY**.
- Managed PostgreSQL backup/retention/PITR: **NOT VERIFIED**.
- Object versioning/replication/lifecycle: **NOT VERIFIED**.
- Real PostgreSQL restore: **NOT TESTED**.
- Real object-storage restore: **NOT TESTED**.
- Full application restore: **NOT TESTED**.
- RPO: **NOT DEFINED**.
- RTO: **NOT DEFINED**.
- P4.12 database migration: **NONE**.

The repository contains an S3-compatible adapter and production configuration requires S3-compatible storage, but that does not identify the actual production vendor.

## Persistent recovery scope

### PostgreSQL
Users, sessions, login identities, verification/reset/OTP state, families, persons, family membership, parent-child links, marriage/divorce/remarriage, guardianship, biographies, life events, memories, photos metadata, photo-person tags, invitations, audit/security data, and photo cleanup state.

### Object storage
Original photos and thumbnails, plus any future persistent uploaded assets.

### Configuration required for recovery
Database connection settings, object-storage endpoint/bucket/region/credentials, authentication secrets, SMTP/SMS/OIDC configuration where post-restore behavior depends on them, and Vercel application environment variables. Credentials must remain outside Git.

## Recovery architecture

```
PostgreSQL backup/PITR + object-storage recovery/versioning
                         ↓
                 isolated restore
                         ↓
              migration/schema checks
                         ↓
             DB ↔ object consistency
                         ↓
       auth + family/tree + memory/photo smoke tests
```

A PostgreSQL backup without the corresponding private photo objects is incomplete.

## RPO / RTO

RPO and RTO are operational targets and cannot be inferred safely from application code.

- RPO: **NOT DEFINED**
- RTO: **NOT DEFINED**

When chosen, verify them against actual backup frequency, retention, object versioning/replication, restore capacity and operator response time.

## Database backup

### Actual status

| Control | Status |
|---|---|
| Production provider | **NOT VERIFIED** |
| Automated backup | **NOT VERIFIED** |
| Retention | **NOT VERIFIED** |
| PITR | **NOT VERIFIED** |
| Encryption | **NOT VERIFIED** |
| Backup access control | **NOT VERIFIED** |
| Monitoring | **NOT CONFIGURED IN REPOSITORY** |
| Real restore | **NOT TESTED** |

### Required operator configuration

Use the actual PostgreSQL provider's native backup/PITR facilities when available. Record frequency, retention, encryption, region/location, restore permissions and the exact isolated restore procedure. Do not commit database dumps or credentials.

## Object storage recovery

### Actual status

| Control | Status |
|---|---|
| Production provider | **NOT VERIFIED** |
| Versioning | **NOT VERIFIED** |
| Backup/replication | **NOT VERIFIED** |
| Lifecycle | **NOT VERIFIED** |
| Monitoring | **NOT CONFIGURED IN REPOSITORY** |
| Real restore | **NOT TESTED** |

Recommended protection is a private bucket, restricted deletion, versioning where appropriate, lifecycle rules compatible with recovery retention, encrypted transport/storage, and an isolated restore bucket/prefix.

## Photo consistency checker

Run:

```bash
cd backend
uv run python -m app.tools.check_storage_consistency
```

It is read-only and reports:

- `ORPHANED_METADATA`: DB photo row exists but original object is missing.
- `ORPHANED_OBJECT`: object under `families/` has no DB reference.
- `MISSING_THUMBNAIL`: original exists but thumbnail is missing.
- `BROKEN_PHOTO`: thumbnail exists while original is missing.
- `INVALID_STORAGE_METADATA`: stored keys do not match the application's expected key layout.

It never deletes records or objects. There is deliberately no automatic `--repair` mode in P4.12.

## Synthetic recovery fixture

`backend/tests/fixtures/recovery_dataset.json` contains only deterministic synthetic names/UUIDs and a synthetic object marker. It has no production data, credentials or real photo.

A real recovery rehearsal should load equivalent synthetic data into an isolated PostgreSQL instance and isolated object-storage namespace.

## Recovery runbook

1. **Detect:** identify affected database/storage and last known-good points.
2. **Contain:** stop unsafe writes if necessary and preserve logs/audit evidence.
3. **Restore DB in isolation:** restore to a separate instance; record `alembic current`; verify `alembic heads`; do not blindly run `alembic upgrade head` until code/revision compatibility is established.
4. **Restore objects in isolation:** restore the corresponding object-storage recovery point into a separate bucket/prefix.
5. **Consistency:** run the P4.12 checker and review all discrepancy classes.
6. **Integrity:** verify foreign keys, family/person membership, parent-child, marriage/divorce/remarriage, guardianship, memories, photo tags and photo metadata.
7. **Application smoke test:** login; User/Person separation; family authorization; tree; search/pagination; memory visibility; private photo access; original/thumbnail retrieval; guardian/minor privacy; audit/security records.
8. **Security decision:** determine whether sessions, reset tokens, OTP state or authentication secrets must be invalidated/rotated.
9. **Production decision:** only after isolated validation and explicit operator authorization restore production.
10. **Post-restore:** repeat smoke tests, monitor, and record incident/recovery evidence.

## Failed migration and rollback

Application rollback, database rollback and disaster recovery are different:

- Application rollback = deploy earlier compatible code.
- Database rollback = controlled schema/data operation; production `downgrade -1` is not the generic recovery mechanism.
- Disaster recovery = restore DB and object storage to known-good recovery points.

For a failed migration:

```
inspect → preserve evidence → identify revision → verify backup
→ choose forward-fix or isolated restore → validate → deploy compatible code
```

Never rewrite historical migrations or force-reset Alembic.

## Authentication/session recovery

The database contains session hashes and identity/recovery state. After a disaster, operators must explicitly decide whether to preserve or invalidate sessions and whether to preserve or rotate signing/authentication secrets. If compromise is suspected, invalidate relevant recovery/session state before reopening access.

## Privacy/security

Recovery copies contain sensitive family history. Never copy production dumps/photos to developer devices, GitHub, random services or test fixtures. Recovery access must be least-privilege, encrypted and auditable.

## Vercel

No P4.12 production deployment is performed. The current P4.11 GitHub check shows a Vercel deployment-rate-limit failure, while the GitHub Actions `verify` workflow for P4.11 completed successfully. Vercel documents Hobby limits of 100 deployments/day and 32 builds/hour. See the official limits page: https://vercel.com/docs/limits

The repository's `main` branch also has a later commit deleting `vercel.json`; P4.12 does not reintroduce it.

## Completion gate

P4.12 should not be called fully production-ready until the actual DB/storage providers and backup settings are verified, an isolated synthetic restore is demonstrated, consistency/integrity checks pass, authentication/privacy checks pass, and the complete CI workflow is green.

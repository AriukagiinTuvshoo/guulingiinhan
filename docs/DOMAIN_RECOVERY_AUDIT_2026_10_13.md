# Domain readiness: backup and recovery audit — 2026-10-13

## Status

**Source safeguards and synthetic recovery checks are verified. Production disaster recovery is not yet verified.**

This pass inspected repository code and runbooks only. No live backup was read,
exported, decrypted or restored. No private key, credential, object inventory or
family record was accessed. No schedule, retention deletion, bucket policy,
database or infrastructure change was made.

The 2026-10-06 drill described in `BACKUP_RECOVERY.md` is historical evidence for
its recorded schema/objects. It does not prove a restore of the current schema,
current media inventory, or production-provider configuration.

## Existing mechanisms inspected

| Mechanism | Actual scope and guards |
| --- | --- |
| `backend/ops/recovery.py:export_sql` | Builds read-only PostgreSQL SQL encrypting application rows inside pgcrypto; accepts a public OpenPGP key and labels the snapshot **staging** |
| `restore_application` | Staging format only; loopback PostgreSQL only; database name must begin `guulingiinhan_restore_`; refuses URL query overrides, mismatched schema/table/column inventory, and nonempty targets; inserts and exact row comparison share one transaction |
| `restore_media` | RSA-OAEP/SHA-256 unwrap plus AES-GCM authentication; validates binary SHA-256 before write; LocalObjectStorage rejects absolute/traversal/Windows drive paths and paths escaping its root |
| `ops/private-media-backup.mjs` | Separate staging maintenance worker with private SOURCE/BACKUP bindings; encrypted key/body/metadata; unique run manifest; 10 MiB/object and 50 MiB/run limits; rejects changed ETags; HTTP trigger requires a secret and unexpired authorization |
| `ops/private-media-recovery-workflow.mjs` | Operator-triggered staging workflow, no cron, public fetch always 404; expiry checked; does not decrypt private media |

The recovery helpers deliberately cannot silently become a production exporter.
`restore_media` restores binary content into an isolated local storage root;
restoring original HTTP/custom metadata to a real R2 target requires a separate
controlled operator procedure and verification. PostgreSQL/application snapshots
do not contain R2 object bytes.

## Evidence reused instead of repeating successful tests

- Parent audit already ran `node --test ops/private-media-backup.test.mjs`: **3 PASS**.
- Backend audit confirmed full `pytest` baseline: **328 PASS**, including all
  `backend/tests/test_recovery.py` cases, with no recovery tests skipped.
- Those Python cases cover binary roundtrip, AES-GCM tampering, checksum failure,
  traversal/drive-path rejection, public/private key format rejection, and guarded
  restore URL validation. They use synthetic keys/data and pytest temporary paths.
- Neither suite proves an actual native PostgreSQL/provider backup restore or a
  current real R2 backup restore.

Runnable focused commands for a future changed-code regression, from repository
root and backend respectively (not rerun by this read-only audit):

```powershell
node --test ops/private-media-backup.test.mjs
```

```powershell
# In backend; use the approved existing development interpreter.
$env:APP_ENV = 'test'
$env:DATABASE_URL = 'sqlite://'
$env:STORAGE_PROVIDER = 'local'
$env:EMAIL_PROVIDER = 'fake'
$env:SMS_PROVIDER = 'fake'
python -m pytest tests/test_recovery.py -q --show-capture=no
```

The tests generate synthetic recovery keys in memory; no live provider credentials
or backup artifacts are necessary.

## Operator configuration inventory — names only

| Name | Purpose / handling |
| --- | --- |
| `DATABASE_URL` | Application PostgreSQL connection; keep its password in a protected secret store |
| `PGSERVICEFILE`, `PGPASSFILE` | Native PostgreSQL operator connection/password files outside Git; owner-only custody, never print their contents |
| `STORAGE_PROVIDER`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION` | Existing storage adapter configuration; verify source versus isolated destination explicitly |
| `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | Private S3/R2 credentials; keep out of command arguments and logs |
| `SOURCE`, `BACKUP` | Maintenance-worker private R2 bindings, separate from application public routing |
| `BACKUP_ENVIRONMENT` | Must be `staging` for the existing helper |
| `BACKUP_RUN_ID` | Unique run identifier; a completed manifest is the success marker |
| `BACKUP_EXPIRES_AT` | Milliseconds since epoch; reject expired one-off authorization |
| `RECOVERY_PUBLIC_KEY` | RSA public key for media encryption; no matching private key on the Worker |
| `BACKUP_TRIGGER_SECRET` | Secret for the maintenance HTTP trigger; not needed by the authenticated workflow entry point |
| OpenPGP public/private key pair | Database export encryption; private decryption key remains outside Git/database/backup bucket |
| RSA private recovery key | Media decryption custody; current loader expects unencrypted PEM bytes, so unlock inside a protected process, not in chat/CI logs |

No values were inspected. Portable key custody, second-operator recovery and actual
provider-backup availability must be demonstrated; a Windows-user-bound DPAPI key
in Temp alone is not a durable recovery arrangement.

## Manual preparation commands that do not read live data

Run from `backend` after placing **only the public** OpenPGP key in an approved
operator directory. This prepares SQL; it does not execute a database export:

```powershell
python -m ops.recovery --public-key "C:\ProtectedRecovery\operator-public.asc" --output-sql "C:\ProtectedRecovery\staging-export.sql"
```

Do not execute the generated SQL on a source database without explicit environment
confirmation and authorization. Use the confirmed staging project, record its
actual migration revision, and store only the encrypted result in private storage.

Native PostgreSQL backup/restore requires installed clients, a confirmed source
service, owner-approved protected storage, encryption tooling and explicit approval.
The command shape is `pg_dump --dbname=service=<confirmed-source> --format=custom`
with **binary stdout streamed directly into an approved encryption process**.
Do not use a plaintext dump in the repository or a PowerShell text-converting pipe.
`pg_dump` covers one database, not cluster-wide roles/tablespaces; provider-native
recovery and protected role/configuration custody must cover those separately.
These native commands were documentation-validated, not executed. [PostgreSQL
pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html),
[connection service files](https://www.postgresql.org/docs/current/libpq-pgservice.html),
[password files](https://www.postgresql.org/docs/current/libpq-pgpass.html).

For an **already-authorized isolated restore drill**, use an empty loopback database
named `guulingiinhan_restore_<run>`, matching the exact snapshot release/revision.
Set `APP_ENV=test`, its explicit loopback `DATABASE_URL`, local storage and disabled
real delivery credentials in the dedicated operator process; do not reuse the app's
live environment. Migrate that empty target to the snapshot revision, then invoke
the existing `restore_application` function. Native archives use `pg_restore`
against the separately confirmed empty target. Never apply `--clean`, a destructive
production downgrade, or a restore to the real source as a drill. [PostgreSQL
pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).

## Concrete gates before production go-live

1. Confirm provider-native database backup/PITR availability for the actual project,
   retention and last successful recovery point. This audit did not read account
   plan/backup state. Supabase documents that managed database backups omit object
   bytes and custom-role passwords; reset those passwords and separately recover
   storage as necessary. [Supabase database backups](https://supabase.com/docs/guides/platform/backups).
2. Approve operational frequency, retention, deletion, alerts, RPO and RTO. The
   repository's proposed policy is not an activated schedule. Previous automatic
   approval rejection of scheduling/deletion remains recorded; this audit did not
   retry or bypass it.
3. Transfer/test decryption-key custody outside Temp and outside the backup store,
   with a second recovery location/operator. Verify both database and media keys.
4. Restore a **current-schema** database backup and current media backup into
   isolated targets. Compare canonical people/family/account relationships,
   all referenced original/thumbnail/profile object bytes, hashes, HTTP metadata
   and custom metadata; record missing and extra objects without exposing names.
5. Run application-readiness, login/session, self-link, admin-role and cross-family
   denial checks on the restored app. Confirm anonymous photo denial and private
   no-store delivery. Historical application-row comparison is not enough.
6. Preserve the verified previous Worker versions/configuration for code rollback.
   Current migrations require a forward-fix or approved database restore strategy;
   code rollback must not imply destructive schema downgrade.
7. For the purchased domain, reconfirm API base/CORS, email public base and enabled
   OIDC callback configuration. DNS/TLS and custom-domain rollout are owned by the
   main deployment audit, not proven by these recovery helpers. A domain attachment
   alone does not complete production recovery.

## Stop boundary

No backup export, ciphertext download, private-key read, native restore, retention
deletion, scheduler activation or live infrastructure operation was performed.
The remaining native/current-data recovery gates are **UNVERIFIED**, not 100% PASS.

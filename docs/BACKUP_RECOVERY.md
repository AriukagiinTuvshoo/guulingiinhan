# Protected backup and isolated recovery

## Verified staging drill — 2026-10-06

The source is Supabase project `gzwekdfuxngtukskzelp` (staging), schema
`b10c8e621f4a`. No production database is read, restored or modified.

- All 44 application tables were exported as one PostgreSQL statement snapshot.
  `pgcrypto` encrypted the JSON inside PostgreSQL to an operator's public OpenPGP
  recovery key using AES-256. Only ciphertext left the SQL tool.
- Ciphertext was stored in private R2 bucket `guulingiinhan-staging-recovery`, key
  `staging/2026-10-06-first-recovery/database.asc`. A download from R2 matched the
  original ciphertext exactly (normalized text SHA-256
  `09931821a9ba66c46a5a99059b81776ecf7a1b55a312e8ec74fe417b713aa80b`).
- Restored into a clean, SCRAM protected, loopback-only PostgreSQL 18.4 database
  `guulingiinhan_restore_20261006`; the source is PostgreSQL 17. Alembic consistency
  passed. Every row in every application table matched the snapshot, with foreign
  keys enforced. Counts included 24 Persons, 13 parent/child relationships,
  5 marriages, 9 users, 3 account/Person links, 4 Families, 3 Stories, 4 Memories,
  1 Photo and 0 Archives.
- Application checks against the restored database passed for eight protected
  read routes, and anonymous requests to those routes were denied. A restore into
  an already populated target is rejected rather than erasing it.
- Both source media and recovery R2 buckets have public `r2.dev` disabled and
  no custom domains. No public backup download endpoint was added to the app.

This application snapshot does **not** replace a native backup of PostgreSQL
roles, Supabase-managed schemas, extensions or provider configuration. Before
production, retain a provider backup/native `pg_dump` alongside it. A database
snapshot does not contain R2 object bytes.

## Recovery key custody

Use a dedicated recovery public key for exports. Keep its matching private key
outside Git, outside the database and separate from backup storage. Store it with
a passphrase in the owner's password manager or offline encrypted custody, with a
second recovery location. Test that a second operator can decrypt a backup before
production. Never paste credentials, private keys, OTPs or snapshot contents into
chat, CI logs or a repository.

The current drill's operator material is in an owner-only local recovery directory
under Windows Temp. DPAPI-sealed keys are bound to that Windows user/host; they
are not a portable disaster-recovery key. Transfer custody to the owner's secure
vault before treating the production backup process as operational. Temp files
must not be the sole long-term copy of a recovery key.

## Backup procedure

1. Confirm environment, project, schema revision and private destination bucket.
   Freeze writes briefly when a consistent database/media pair is required.
2. Produce a native provider/`pg_dump` backup using the owner's protected database
   credentials. Use a private local working directory and an encrypted output
   stream. Do not put a password in command arguments or publish a plaintext dump.
3. For the tested application snapshot, run from `backend`:
   `python -m ops.recovery --public-key <public-key.asc> --output-sql <export.sql>`.
   Execute that read-only SQL on the explicitly confirmed staging project; store
   only its armored encrypted result. The helper intentionally labels and limits
   this format to staging; do not silently repurpose it as a production export.
4. Name each run with environment + UTC timestamp + schema revision/commit.
   Upload encrypted outputs to a private bucket with operator-only access. Record
   ciphertext SHA-256, schema revision, timestamp, source environment and counts
   in a private inventory. Keep production and staging destinations separate.
5. Export private R2 objects using native object bytes, not a text-converting API
   adapter. `ops/private-media-backup.mjs` is a separate staging maintenance
   Worker: SOURCE is private media, BACKUP is private recovery, and only the RSA
   public key is configured in plain text. Per-object AES-256-GCM encrypts bytes,
   object key and metadata; RSA-OAEP SHA-256 wraps the data key. Object names in
   the backup are opaque hashes. Configure a random secret trigger through Worker
   secrets, an expiry and a unique run ID. No credentials or media are returned by
   its HTTP response. Delete this temporary Worker after a successful drill.
6. The bounded helper rejects objects over 10 MiB and runs over 50 MiB. Larger
   datasets require an operator batch export using the existing S3 adapter and the
   same encryption format, with version/etag checks and an interrupted-run policy;
   do not increase limits without load verification.
7. Confirm backup completion, counts and ciphertext integrity. Only a completed
   manifest is a successful media backup. Restore representative objects and test
   their application authorization before marking recovery PASS.

## Retention and operating schedule

Proposed production policy: one protected daily backup; keep daily snapshots for
30 days, monthly snapshots for 12 months, and the backup immediately preceding a
release until that release's rollback window ends. Quarterly, restore an actual
backup into an isolated instance. Alert the operator on a missed backup or failed
restore. Agree the recovery point/time objectives with the owner before go-live.

**Not activated:** a persistent schedule and 30-day automatic deletion of staging
backups were rejected by automatic approval review. No recurring schedule or
lifecycle deletion rule was installed. The owner must approve frequency, retention
and deletion before activation. Until then, retain the drill backup and document
manual operator runs; do not claim scheduled backups are running.

## Restore procedure

1. Create an isolated instance with loopback/private access, a fresh random
   password and an empty database named `guulingiinhan_restore_<run>`.
2. Use the exact release/schema matching the backup. Run `alembic upgrade head`
   on the **isolated empty** instance, never on the real source as part of a drill.
3. Download the encrypted backup through authenticated operator access; verify
   its ciphertext hash. Decrypt only in a protected local scratch directory.
4. Call `ops.recovery.restore_application(snapshot, database_url)`. It rejects a
   remote host, a database without the disposable prefix, wrong schema/table
   inventory and any nonempty target. Insert and exact-row comparison are one
   transaction; errors must not log private row values.
5. For each media envelope, use `ops.recovery.restore_media` with the private RSA
   recovery key and a protected isolated storage root. AES-GCM authentication,
   SHA-256 and object-key/path validation must all pass before any write.
6. Check every database reference resolves to its restored object. Preserve HTTP
   and custom metadata from the encrypted record when restoring to R2; never copy
   the bucket's public access settings from an untrusted export. Local test storage
   uses the DB/API content type and does not publish metadata.
7. Run Alembic consistency, application read routes, account/Person/Family link
   checks and cross-Family denial. Check profile and Memory original/thumbnail
   content, `Cache-Control: private, no-store`, and anonymous denial. Stories reuse
   Memory photo delivery; Archive binary uploads are not implemented at this
   revision, so do not invent an Archive-file restore PASS.
8. Retain only safe aggregate evidence. Stop the disposable instance and remove
   plaintext dump/media/key scratch files after the drill. Keep encrypted backups
   and recovery keys in their separate approved custody locations.

References: [PostgreSQL pgcrypto](https://www.postgresql.org/docs/17/pgcrypto.html),
[Supabase backups](https://supabase.com/docs/guides/platform/backups),
[R2 lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

#!/bin/sh
# Strict test-only drill. Run with PostgreSQL 16 clients against a disposable
# local PostgreSQL 16 database named guulingiinhan_restore_source_*.
set -eu
: "${PGHOST:?Set PGHOST}"
: "${PGPORT:?Set PGPORT}"
: "${PGUSER:?Set PGUSER}"
: "${PGDATABASE:?Set PGDATABASE}"
case "$PGHOST" in localhost|127.0.0.1) ;; *) echo 'Refusing non-local server' >&2; exit 1;; esac
case "$PGDATABASE" in guulingiinhan_restore_source_*) ;; *) echo 'Refusing non-disposable source database' >&2; exit 1;; esac
case "$PGDATABASE" in *[!a-zA-Z0-9_]*) echo 'Invalid source database name' >&2; exit 1;; esac
export PGHOST PGPORT PGUSER PGDATABASE

for binary in pg_dump pg_restore psql createdb dropdb; do
  command -v "$binary" >/dev/null
  "$binary" --version
  case "$("$binary" --version)" in *' 16.'*) ;; *) echo "PostgreSQL 16 $binary required" >&2; exit 1;; esac
done
server_version=$(psql -X -v ON_ERROR_STOP=1 -At -c 'SHOW server_version_num')
case "$server_version" in 16????) ;; *) echo "PostgreSQL 16 server required, got $server_version" >&2; exit 1;; esac
psql -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE TABLE restore_drill_probe (marker text NOT NULL);
INSERT INTO restore_drill_probe VALUES ('isolated-restore-ok');
WITH fixture_user AS (
  INSERT INTO users (id, email, display_name, is_active, created_at, updated_at)
  VALUES (gen_random_uuid(), 'restore-drill@example.com', 'Restore fixture', true, now(), now())
  RETURNING id
)
INSERT INTO families (id, name, created_by, created_at)
SELECT gen_random_uuid(), 'Restore fixture family', id, now() FROM fixture_user;
SQL
source_revision=$(psql -X -v ON_ERROR_STOP=1 -At -c 'SELECT version_num FROM alembic_version')
[ -n "$source_revision" ] || { echo 'Source migration revision missing' >&2; exit 1; }
dump_dir=$(mktemp -d "${TMPDIR:-/tmp}/guulingiinhan-restore-drill.XXXXXXXX")
dump="$dump_dir/source.dump"
dest="guulingiinhan_restore_drill_$(date -u +%Y%m%d%H%M%S)_$$"
created=0
cleanup() {
  if [ "$created" = 1 ]; then dropdb --if-exists "$dest" || echo "WARNING: failed to drop disposable database $dest" >&2; fi
  rm -f "$dump"
  rmdir "$dump_dir"
}
trap cleanup EXIT HUP INT TERM
pg_dump --format=custom --no-owner --no-privileges --file="$dump" "$PGDATABASE"
pg_restore --list "$dump" >/dev/null
createdb --maintenance-db=postgres "$dest"
created=1
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$dest" "$dump"
restored_revision=$(psql -X -v ON_ERROR_STOP=1 -At --dbname="$dest" -c 'SELECT version_num FROM alembic_version')
marker=$(psql -X -v ON_ERROR_STOP=1 -At --dbname="$dest" -c 'SELECT marker FROM restore_drill_probe')
fixture=$(psql -X -v ON_ERROR_STOP=1 -At --dbname="$dest" -c "SELECT count(*) FROM families f JOIN users u ON u.id=f.created_by WHERE f.name='Restore fixture family' AND u.email='restore-drill@example.com'")
[ "$source_revision" = "$restored_revision" ] && [ "$marker" = 'isolated-restore-ok' ] && [ "$fixture" = 1 ] || { echo 'Restore data or revision mismatch' >&2; exit 1; }
printf 'Strict isolated PostgreSQL restore passed; server=%s revision=%s\n' "$server_version" "$restored_revision"

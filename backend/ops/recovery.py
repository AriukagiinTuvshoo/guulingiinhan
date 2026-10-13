"""Operator-only encrypted application export and guarded isolated restore.

No HTTP endpoint is added. Production operators should also retain a native
provider/pg_dump backup for PostgreSQL roles and non-application schemas.
"""

import argparse
import base64
import hashlib
import json
import re
from datetime import UTC, date, datetime
from pathlib import Path
from uuid import UUID

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import create_engine, insert, select, text
from sqlalchemy.engine import make_url

from app import models  # noqa: F401
from app.db import Base
from app.storage import LocalObjectStorage

FORMAT = "guulingiinhan-app-v1"
MEDIA_FORMAT = "guulingiinhan-media-v1"


def export_sql(public_key: str) -> str:
    if not public_key.startswith("-----BEGIN PGP PUBLIC KEY BLOCK-----"):
        raise ValueError("Use a public OpenPGP recovery key, never a private key")
    if "$recovery_public_key$" in public_key:
        raise ValueError("Invalid public key")
    fragments = []
    for table in Base.metadata.sorted_tables:
        if not re.fullmatch(r"[a-z_]+", table.name):
            raise ValueError("Unexpected application table")
        fragments.append(
            f"'{table.name}', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) "
            f'from public."{table.name}" t)'
        )
    tables = ",\n".join(fragments)
    return (
        "-- Read-only application snapshot; encrypted inside PostgreSQL.\n"
        "select extensions.armor(extensions.pgp_pub_encrypt(\n"
        f"jsonb_build_object('format','{FORMAT}','environment','staging',\n"
        "'created_at',now(),'schema_revision',(select version_num from public.alembic_version),\n"
        f"'tables',jsonb_build_object({tables}))::text,\n"
        f"extensions.dearmor($recovery_public_key${public_key}$recovery_public_key$),\n"
        "'cipher-algo=aes256,compress-algo=1')) as encrypted_backup;\n"
    )


def validate_restore_url(database_url: str) -> None:
    url = make_url(database_url)
    if url.query:
        raise ValueError("Restore URL must not include connection overrides")
    if url.get_backend_name() != "postgresql" or url.host not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Restore is restricted to an isolated local PostgreSQL instance")
    if not (url.database or "").startswith("guulingiinhan_restore_"):
        raise ValueError("Restore database must start with guulingiinhan_restore_")


def _typed(column, value):
    if value is None:
        return None
    kind = column.type.python_type
    if kind is UUID:
        return UUID(value)
    if kind is datetime:
        return datetime.fromisoformat(value)
    if kind is date:
        return date.fromisoformat(value)
    if kind is bytes:
        raise ValueError("Binary column needs a native PostgreSQL backup")
    return value


def restore_application(snapshot: dict, database_url: str) -> dict:
    validate_restore_url(database_url)
    if snapshot.get("format") != FORMAT or snapshot.get("environment") != "staging":
        raise ValueError("Unexpected snapshot format or environment")
    expected = set(Base.metadata.tables)
    if set(snapshot.get("tables", {})) != expected:
        raise ValueError("Application table inventory does not match this revision")
    engine = create_engine(database_url, echo=False, hide_parameters=True)
    counts = {}
    with engine.begin() as connection:
        revision = connection.scalar(text("select version_num from alembic_version"))
        if revision != snapshot["schema_revision"]:
            raise ValueError("Migrate the isolated database to the snapshot revision first")
        for table in Base.metadata.sorted_tables:
            if connection.execute(select(table).limit(1)).first() is not None:
                raise ValueError("Restore target is not empty; existing data will not be erased")
        for table in Base.metadata.sorted_tables:
            rows = snapshot["tables"][table.name]
            for row in rows:
                if set(row) != set(table.columns.keys()):
                    raise ValueError("Snapshot column inventory does not match")
                connection.execute(insert(table).values({
                    column.name: _typed(column, row[column.name]) for column in table.columns
                }))
            counts[table.name] = len(rows)
        # Postgres enforces every foreign key while loading; compare all rows,
        # not just aggregate counts, without exposing their contents.
        for table in Base.metadata.sorted_tables:
            actual = [dict(row) for row in connection.execute(select(table)).mappings()]
            def normalized(row):
                canonical = {name: value.astimezone(UTC).isoformat() if isinstance(value, datetime)
                             else value for name, value in row.items()}
                return json.dumps(canonical, sort_keys=True, default=str, ensure_ascii=False)
            expected_rows = [{column.name: _typed(column, row[column.name])
                              for column in table.columns} for row in snapshot["tables"][table.name]]
            if sorted(map(normalized, actual)) != sorted(map(normalized, expected_rows)):
                raise ValueError("Restored row comparison failed")
    engine.dispose()
    return {"schema_revision": snapshot["schema_revision"], "table_counts": counts,
            "exact_row_comparison": "PASS"}


def restore_media(envelope: dict, private_key_pem: bytes, destination: Path) -> dict:
    if envelope.get("format") != MEDIA_FORMAT:
        raise ValueError("Unknown encrypted media format")
    key = serialization.load_pem_private_key(private_key_pem, password=None)
    secret = key.decrypt(base64.b64decode(envelope["wrapped_key"], validate=True), padding.OAEP(
        mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None,
    ))
    payload = AESGCM(secret).decrypt(
        base64.b64decode(envelope["nonce"], validate=True),
        base64.b64decode(envelope["ciphertext"], validate=True), MEDIA_FORMAT.encode(),
    )
    record = json.loads(payload)
    content = base64.b64decode(record["body"], validate=True)
    if hashlib.sha256(content).hexdigest() != record["sha256"]:
        raise ValueError("Recovered media checksum mismatch")
    storage = LocalObjectStorage(destination)
    storage.put(record["key"], content, record["http_metadata"].get("contentType", "application/octet-stream"))
    return {"key": record["key"], "bytes": len(content), "sha256": record["sha256"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-key", type=Path, required=True)
    parser.add_argument("--output-sql", type=Path, required=True)
    args = parser.parse_args()
    args.output_sql.write_text(export_sql(args.public_key.read_text()), encoding="utf-8")
    print("Prepared read-only encrypted export SQL; no private key or data printed.")


if __name__ == "__main__":
    main()

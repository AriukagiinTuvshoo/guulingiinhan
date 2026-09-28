"""Enforce one active invitation per family and canonical email.

Revision ID: b3e6c9f1a204
Revises: f4a7c2d9e611

This restores the database-level invitation uniqueness invariant that was
previously proposed in an unmerged historical migration.

For existing duplicate active rows, the oldest row by created_at and id is
preserved. Later duplicates are revoked deterministically so the partial
unique index can be created without deleting invitation history.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "b3e6c9f1a204"
down_revision = "f4a7c2d9e611"
branch_labels = None
depends_on = None

_INDEX_NAME = "uq_invitation_active_family_email"
_ACTIVE_PREDICATE = "accepted_at IS NULL AND revoked_at IS NULL"


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, family_id, invited_email, created_at "
            "FROM invitations "
            f"WHERE {_ACTIVE_PREDICATE} "
            "ORDER BY family_id, invited_email, created_at ASC, id ASC"
        )
    ).mappings()

    seen: set[tuple[str, str]] = set()
    now = datetime.now(UTC)
    for row in rows:
        key = (str(row["family_id"]), row["invited_email"])
        if key in seen:
            bind.execute(
                sa.text(
                    "UPDATE invitations "
                    "SET revoked_at = :revoked_at "
                    "WHERE id = :id"
                ),
                {"id": row["id"], "revoked_at": now},
            )
        else:
            seen.add(key)

    op.create_index(
        _INDEX_NAME,
        "invitations",
        ["family_id", "invited_email"],
        unique=True,
        sqlite_where=sa.text(_ACTIVE_PREDICATE),
        postgresql_where=sa.text(_ACTIVE_PREDICATE),
    )


def downgrade() -> None:
    op.drop_index(_INDEX_NAME, table_name="invitations")

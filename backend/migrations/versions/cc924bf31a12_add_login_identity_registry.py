"""add login identity registry and backfill unique legacy emails

Revision ID: cc924bf31a12
Revises: b762e4a19d30
Create Date: 2026-09-24
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from alembic import op

revision = "cc924bf31a12"
down_revision = "b762e4a19d30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "login_identities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("normalized_identifier", sa.String(length=320), nullable=True),
        sa.Column("display_identifier", sa.String(length=320), nullable=True),
        sa.Column("issuer", sa.String(length=500), nullable=True),
        sa.Column("subject", sa.String(length=255), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("provider IN ('email', 'phone', 'google')", name="ck_identity_provider"),
        sa.CheckConstraint(
            "(provider IN ('email', 'phone') AND normalized_identifier IS NOT NULL "
            "AND normalized_identifier <> '' "
            "AND issuer IS NULL AND subject IS NULL) OR "
            "(provider = 'google' AND normalized_identifier IS NULL "
            "AND issuer IS NOT NULL AND issuer <> '' "
            "AND subject IS NOT NULL AND subject <> '')",
            name="ck_identity_provider_fields",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_identity_provider_identifier",
        "login_identities",
        ["provider", "normalized_identifier"],
        unique=True,
        sqlite_where=sa.text("provider IN ('email', 'phone')"),
        postgresql_where=sa.text("provider IN ('email', 'phone')"),
    )
    op.create_index(
        "uq_identity_google_subject",
        "login_identities",
        ["provider", "issuer", "subject"],
        unique=True,
        sqlite_where=sa.text("provider = 'google'"),
        postgresql_where=sa.text("provider = 'google'"),
    )
    op.create_index("ix_login_identity_user", "login_identities", ["user_id"])

    # Backfill only unambiguous normalized emails. Case-variant legacy duplicates
    # remain usable through the guarded legacy lookup; assigning either account
    # ownership to the shared identity would be unsafe.
    bind = op.get_bind()
    users = bind.execute(
        sa.text("SELECT id, email, email_verified_at FROM users WHERE email IS NOT NULL")
    ).all()
    normalized_groups: dict[str, list[tuple[object, str, datetime | None]]] = {}
    for user_id, email, verified_at in users:
        normalized = str(email).strip().casefold()
        if normalized:
            if isinstance(verified_at, str):
                verified_at = datetime.fromisoformat(verified_at)
            normalized_groups.setdefault(normalized, []).append((user_id, str(email), verified_at))

    now = datetime.now(UTC)
    identity_table = sa.table(
        "login_identities",
        sa.column("id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("provider", sa.String()),
        sa.column("normalized_identifier", sa.String()),
        sa.column("display_identifier", sa.String()),
        sa.column("verified_at", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    rows = [
        {
            "id": uuid4(),
            "user_id": UUID(str(group[0][0])),
            "provider": "email",
            "normalized_identifier": normalized,
            "display_identifier": group[0][1],
            "verified_at": group[0][2],
            "created_at": now,
            "updated_at": now,
        }
        for normalized, group in normalized_groups.items()
        if len(group) == 1
    ]
    if rows:
        bind.execute(identity_table.insert(), rows)

    op.create_table(
        "identity_link_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("normalized_identifier", sa.String(length=320), nullable=True),
        sa.Column("display_identifier", sa.String(length=320), nullable=True),
        sa.Column("issuer", sa.String(length=500), nullable=True),
        sa.Column("subject", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "provider IN ('email', 'phone', 'google')", name="ck_identity_link_provider"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'consumed', 'expired', 'cancelled')",
            name="ck_identity_link_status",
        ),
        sa.CheckConstraint(
            "(provider IN ('email', 'phone') AND normalized_identifier IS NOT NULL "
            "AND normalized_identifier <> '' AND issuer IS NULL AND subject IS NULL) OR "
            "(provider = 'google' AND normalized_identifier IS NULL "
            "AND issuer IS NOT NULL AND issuer <> '' "
            "AND subject IS NOT NULL AND subject <> '')",
            name="ck_identity_link_provider_fields",
        ),
        sa.CheckConstraint(
            "(status = 'consumed' AND consumed_at IS NOT NULL) OR "
            "(status <> 'consumed' AND consumed_at IS NULL)",
            name="ck_identity_link_consumed_state",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_identity_link_user_created", "identity_link_requests", ["user_id", "created_at"]
    )
    op.create_index("ix_identity_link_expiry", "identity_link_requests", ["expires_at"])


def downgrade() -> None:
    op.drop_table("identity_link_requests")
    op.drop_table("login_identities")

"""add family and person scoped guardianship grants

Revision ID: b762e4a19d30
Revises: 74a31c87f462
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "b762e4a19d30"
down_revision = "74a31c87f462"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "person_guardianships",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.Column("guardian_user_id", sa.Uuid(), nullable=False),
        sa.Column("scope", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("granted_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_user_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "scope IN ('view_profile', 'edit_profile', 'manage_biography', "
            "'manage_events', 'manage_memories', 'manage_media')",
            name="ck_guardianship_scope",
        ),
        sa.CheckConstraint("status IN ('active', 'revoked')", name="ck_guardianship_status"),
        sa.CheckConstraint(
            "(status = 'active' AND revoked_at IS NULL AND revoked_by_user_id IS NULL) OR "
            "(status = 'revoked' AND revoked_at IS NOT NULL)",
            name="ck_guardianship_revocation_state",
        ),
        sa.ForeignKeyConstraint(
            ["family_id", "person_id"],
            ["family_persons.family_id", "family_persons.person_id"],
            ondelete="CASCADE",
            name="fk_guardianship_family_person",
        ),
        sa.ForeignKeyConstraint(
            ["family_id", "guardian_user_id"],
            ["family_members.family_id", "family_members.user_id"],
            ondelete="CASCADE",
            name="fk_guardianship_family_member",
        ),
        sa.ForeignKeyConstraint(
            ["granted_by_user_id"], ["users.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["revoked_by_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_guardianship_active_scope",
        "person_guardianships",
        ["family_id", "person_id", "guardian_user_id", "scope"],
        unique=True,
        sqlite_where=sa.text("status = 'active' AND revoked_at IS NULL"),
        postgresql_where=sa.text("status = 'active' AND revoked_at IS NULL"),
    )
    op.create_index(
        "ix_guardianship_scope_lookup",
        "person_guardianships",
        ["family_id", "person_id", "guardian_user_id", "status"],
    )
    op.create_index(
        "ix_guardianship_guardian_user", "person_guardianships", ["guardian_user_id"]
    )


def downgrade() -> None:
    op.drop_table("person_guardianships")

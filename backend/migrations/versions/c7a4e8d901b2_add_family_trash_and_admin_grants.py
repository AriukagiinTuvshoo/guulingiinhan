"""Add family detachment trash and membership-scoped admin grants.

Revision ID: c7a4e8d901b2
Revises: b3e6c9f1a204
"""
import sqlalchemy as sa
from alembic import op

revision = "c7a4e8d901b2"
down_revision = "b3e6c9f1a204"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "family_admin_grants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("family_members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope", sa.String(32), nullable=False),
        sa.Column("granted_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("member_id", "scope", name="uq_family_admin_grant"),
        sa.CheckConstraint("scope IN ('view_audit', 'manage_trash', 'manage_settings')", name="ck_family_admin_grant_scope"),
    )
    op.create_table(
        "family_trash_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("family_id", sa.Uuid(), sa.ForeignKey("families.id", ondelete="CASCADE"), nullable=False),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("persons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("deleted_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("assignment_present", sa.Boolean(), nullable=False),
        sa.Column("branch_present", sa.Boolean(), nullable=False),
        sa.Column("lineage_id", sa.Uuid(), sa.ForeignKey("lineages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("family_id", "person_id", name="uq_family_trash_person"),
    )
    op.create_index("ix_family_trash_deleted_at", "family_trash_records", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_family_trash_deleted_at", table_name="family_trash_records")
    op.drop_table("family_trash_records")
    op.drop_table("family_admin_grants")

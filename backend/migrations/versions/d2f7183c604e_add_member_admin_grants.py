"""Add membership management grants without changing existing grant constraints.

Revision ID: d2f7183c604e
Revises: c7a4e8d901b2
"""
import sqlalchemy as sa
from alembic import op

revision = "d2f7183c604e"
down_revision = "c7a4e8d901b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "family_admin_extended_grants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("family_members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope", sa.String(32), nullable=False),
        sa.Column("granted_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("member_id", "scope", name="uq_family_admin_extended_grant"),
        sa.CheckConstraint("scope IN ('manage_members')", name="ck_family_admin_extended_grant_scope"),
    )


def downgrade() -> None:
    op.drop_table("family_admin_extended_grants")

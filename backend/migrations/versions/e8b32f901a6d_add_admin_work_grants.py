"""Add people/content grants without altering existing grant constraints.

Revision ID: e8b32f901a6d
Revises: d2f7183c604e
"""
import sqlalchemy as sa
from alembic import op

revision = "e8b32f901a6d"
down_revision = "d2f7183c604e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "family_admin_work_grants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("family_members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope", sa.String(32), nullable=False),
        sa.Column("granted_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("member_id", "scope", name="uq_family_admin_work_grant"),
        sa.CheckConstraint("scope IN ('manage_people', 'manage_content')", name="ck_family_admin_work_grant_scope"),
    )


def downgrade() -> None:
    op.drop_table("family_admin_work_grants")

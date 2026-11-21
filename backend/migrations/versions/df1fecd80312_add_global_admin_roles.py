"""Add global admin grants, separate from family membership."""

import sqlalchemy as sa
from alembic import op

revision = "df1fecd80312"
down_revision = "b3e6c9f1a204"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_grants",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("granted_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('SUPER_ADMIN', 'ADMIN', 'MODERATOR')", name="ck_admin_grant_role"),
    )
    op.create_table(
        "admin_bootstrap",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("admin_bootstrap")
    op.drop_table("admin_grants")

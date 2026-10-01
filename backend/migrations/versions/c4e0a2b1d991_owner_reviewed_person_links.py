"""Add owner-reviewed Person link requests.

Revision ID: c4e0a2b1d991
Revises: b3e6c9f1a204
"""

import sqlalchemy as sa
from alembic import op

revision = "c4e0a2b1d991"
down_revision = "b3e6c9f1a204"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "person_link_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("family_id", sa.Uuid(), sa.ForeignKey("families.id", ondelete="CASCADE"), nullable=False),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("persons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("decided_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="ck_person_link_request_status"),
    )
    op.create_index("ix_person_link_request_family_status", "person_link_requests", ["family_id", "status"])
    op.create_index("uq_person_link_request_pending_user", "person_link_requests", ["family_id", "user_id"],
                    unique=True, postgresql_where=sa.text("status = 'pending'"),
                    sqlite_where=sa.text("status = 'pending'"))


def downgrade() -> None:
    op.drop_index("uq_person_link_request_pending_user", table_name="person_link_requests")
    op.drop_index("ix_person_link_request_family_status", table_name="person_link_requests")
    op.drop_table("person_link_requests")

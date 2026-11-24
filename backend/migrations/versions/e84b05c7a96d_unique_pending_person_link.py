"""Prevent duplicate pending Person link requests per account and family."""

import sqlalchemy as sa
from alembic import op

revision = "e84b05c7a96d"
down_revision = "b82f4c91d0a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    duplicates = connection.execute(
        sa.text(
            "SELECT 1 FROM person_link_requests "
            "WHERE status = 'pending' "
            "GROUP BY family_id, user_id HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if duplicates:
        raise RuntimeError(
            "Cannot add the pending person link uniqueness constraint while duplicate requests exist."
        )

    op.create_index(
        "uq_person_link_request_pending_user",
        "person_link_requests",
        ["family_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
        sqlite_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_person_link_request_pending_user",
        table_name="person_link_requests",
    )

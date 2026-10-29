"""Bound retries for failed photo object cleanup.

Revision ID: c441b2f3a805
Revises: e8b0a6c14d29
"""

import sqlalchemy as sa
from alembic import op

revision = "c441b2f3a805"
down_revision = "e8b0a6c14d29"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("request_id", sa.String(36), nullable=True))
    op.create_index("ix_audit_logs_request_id", "audit_logs", ["request_id"])
    with op.batch_alter_table("photos") as batch:
        batch.add_column(
            sa.Column("cleanup_attempts", sa.Integer(), nullable=False, server_default="0")
        )
        batch.create_check_constraint(
            "ck_photo_cleanup_attempts", "cleanup_attempts >= 0 AND cleanup_attempts <= 20"
        )


def downgrade() -> None:
    bind = op.get_bind()
    pending_attempts = bind.execute(
        sa.text(
            "SELECT count(*) FROM photos WHERE storage_status != 'ready' AND cleanup_attempts > 0"
        )
    ).scalar_one()
    if pending_attempts:
        raise RuntimeError("Refusing to remove retry counts while photo cleanup is pending.")
    op.drop_index("ix_audit_logs_request_id", table_name="audit_logs")
    op.drop_column("audit_logs", "request_id")
    with op.batch_alter_table("photos") as batch:
        batch.drop_constraint("ck_photo_cleanup_attempts", type_="check")
        batch.drop_column("cleanup_attempts")

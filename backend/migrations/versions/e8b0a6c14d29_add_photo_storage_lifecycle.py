"""Track private photo upload and deletion state for safe retries.

Revision ID: e8b0a6c14d29
Revises: d4a9f73b8210
"""

import sqlalchemy as sa
from alembic import op

revision = "e8b0a6c14d29"
down_revision = "d4a9f73b8210"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("photos") as batch:
        batch.add_column(sa.Column("storage_status", sa.String(20), nullable=True))
    op.execute("UPDATE photos SET storage_status = 'ready' WHERE storage_status IS NULL")
    with op.batch_alter_table("photos") as batch:
        batch.alter_column(
            "storage_status",
            existing_type=sa.String(20),
            nullable=False,
            server_default=sa.text("'ready'"),
        )
        batch.create_check_constraint(
            "ck_photo_storage_status",
            "storage_status IN ('uploading', 'ready', 'deletion_pending')",
        )
    op.create_index(
        "ix_photo_family_storage_status", "photos", ["family_id", "storage_status", "created_at"]
    )


def downgrade() -> None:
    bind = op.get_bind()
    pending = bind.execute(
        sa.text("SELECT count(*) FROM photos WHERE storage_status != 'ready'")
    ).scalar_one()
    if pending:
        raise RuntimeError(
            "Refusing to remove photo lifecycle state while uploads or storage cleanup are pending."
        )
    op.drop_index("ix_photo_family_storage_status", table_name="photos")
    with op.batch_alter_table("photos") as batch:
        batch.drop_constraint("ck_photo_storage_status", type_="check")
        batch.drop_column("storage_status")

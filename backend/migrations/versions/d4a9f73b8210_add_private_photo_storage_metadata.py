"""Add metadata for memory photos stored outside PostgreSQL.

Revision ID: d4a9f73b8210
Revises: b51c9e7a60f4
"""

import sqlalchemy as sa
from alembic import op

revision = "d4a9f73b8210"
down_revision = "b51c9e7a60f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("memories") as batch:
        batch.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE memories SET updated_at = created_at WHERE updated_at IS NULL")
    with op.batch_alter_table("memories") as batch:
        batch.alter_column("updated_at", nullable=False)

    with op.batch_alter_table("photos") as batch:
        batch.add_column(sa.Column("thumbnail_object_key", sa.String(500), nullable=True))
        batch.add_column(sa.Column(
            "original_filename", sa.String(255), nullable=False, server_default="photo"
        ))
        batch.add_column(sa.Column(
            "mime_type", sa.String(80), nullable=False, server_default="image/jpeg"
        ))
        batch.add_column(sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("width", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("height", sa.Integer(), nullable=True))
    op.create_index("ix_photo_memory_created", "photos", ["memory_id", "created_at"])
    op.create_index("ix_photo_person_tag_person", "photo_person_tags", ["person_id"])


def downgrade() -> None:
    bind = op.get_bind()
    uploaded = bind.execute(sa.text(
        "SELECT count(*) FROM photos WHERE thumbnail_object_key IS NOT NULL OR file_size > 0"
    )).scalar_one()
    if uploaded:
        raise RuntimeError(
            "Refusing to remove photo metadata while uploaded media exists; back up and migrate "
            "objects before downgrading."
        )
    op.drop_index("ix_photo_person_tag_person", table_name="photo_person_tags")
    op.drop_index("ix_photo_memory_created", table_name="photos")
    with op.batch_alter_table("photos") as batch:
        for column in (
            "height", "width", "file_size", "mime_type", "original_filename",
            "thumbnail_object_key",
        ):
            batch.drop_column(column)
    with op.batch_alter_table("memories") as batch:
        batch.drop_column("updated_at")

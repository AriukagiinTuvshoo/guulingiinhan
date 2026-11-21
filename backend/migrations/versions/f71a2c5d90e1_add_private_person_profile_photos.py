"""Add private R2-backed portrait storage for people."""

import sqlalchemy as sa
from alembic import op

revision = "f71a2c5d90e1"
down_revision = "a31e6d7f42c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("persons", sa.Column("profile_photo_key", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("persons", "profile_photo_key")

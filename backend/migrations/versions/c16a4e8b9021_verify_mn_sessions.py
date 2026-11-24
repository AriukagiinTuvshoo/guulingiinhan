"""Bind Verify.MN sessions to the existing expiring phone challenge registry.

No account, person, family, or relationship data is changed.
"""
import sqlalchemy as sa
from alembic import op

revision = "c16a4e8b9021"
down_revision = "b10c8e621f4a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("profile_photo_key", sa.String(1024), nullable=True))
    op.add_column("users", sa.Column("profile_photo_cleanup", sa.Text(), nullable=True))
    op.add_column("email_verification_tokens", sa.Column("target_email", sa.String(320), nullable=True))
    with op.batch_alter_table("phone_otp_challenges") as batch:
        batch.add_column(sa.Column("provider_session_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("provider_checked_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_unique_constraint("uq_phone_provider_session", ["provider_session_id"])


def downgrade() -> None:
    op.drop_column("email_verification_tokens", "target_email")
    op.drop_column("users", "profile_photo_key")
    op.drop_column("users", "profile_photo_cleanup")
    with op.batch_alter_table("phone_otp_challenges") as batch:
        batch.drop_constraint("uq_phone_provider_session", type_="unique")
        batch.drop_column("provider_checked_at")
        batch.drop_column("provider_session_id")

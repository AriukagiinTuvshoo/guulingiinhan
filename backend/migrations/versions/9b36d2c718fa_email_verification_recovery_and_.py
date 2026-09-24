"""add email verification, password reset, and invitation revocation

Revision ID: 9b36d2c718fa
Revises: 2e9d7f4c1a63
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "9b36d2c718fa"
down_revision = "2e9d7f4c1a63"
branch_labels = None
depends_on = None


def _create_auth_token_table(table_name: str, index_prefix: str) -> None:
    op.create_table(
        table_name,
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(f"ix_{index_prefix}_user_created", table_name, ["user_id", "created_at"])
    op.create_index(f"ix_{index_prefix}_created", table_name, ["created_at"])
    op.create_index(f"ix_{index_prefix}_expiry", table_name, ["expires_at"])


def upgrade() -> None:
    _create_auth_token_table("email_verification_tokens", "email_verification")
    _create_auth_token_table("password_reset_tokens", "password_reset")
    op.add_column("invitations", sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_invitation_expiry", "invitations", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_invitation_expiry", table_name="invitations")
    op.drop_column("invitations", "revoked_at")
    op.drop_table("password_reset_tokens")
    op.drop_table("email_verification_tokens")

"""add phone OTP challenge storage

Revision ID: 2e9d7f4c1a63
Revises: cc924bf31a12
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "2e9d7f4c1a63"
down_revision = "cc924bf31a12"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "phone_otp_challenges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("phone_e164", sa.String(length=16), nullable=False),
        sa.Column("purpose", sa.String(length=24), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_ip_hash", sa.String(length=64), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('phone_link', 'phone_login', 'password_recovery')",
            name="ck_phone_otp_purpose",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'consumed', 'expired', 'locked', 'superseded')",
            name="ck_phone_otp_status",
        ),
        sa.CheckConstraint("attempt_count >= 0 AND max_attempts > 0", name="ck_phone_otp_attempts"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_phone_otp_phone_purpose_created",
        "phone_otp_challenges",
        ["phone_e164", "purpose", "created_at"],
    )
    op.create_index("ix_phone_otp_expiry", "phone_otp_challenges", ["expires_at"])
    op.create_index("ix_phone_otp_user_created", "phone_otp_challenges", ["user_id", "created_at"])
    op.create_index(
        "uq_phone_otp_pending",
        "phone_otp_challenges",
        ["phone_e164", "purpose"],
        unique=True,
        sqlite_where=sa.text("status = 'pending'"),
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_table("phone_otp_challenges")

"""support phone registration and phone-only user accounts

Revision ID: 9f4c2d7e8a31
Revises: 8e3a1b7c5d42
Create Date: 2026-09-25
"""
import sqlalchemy as sa
from alembic import op
revision = "9f4c2d7e8a31"
down_revision = "e7c4a19d5f20"
branch_labels = None
depends_on = None

def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.alter_column("email", existing_type=sa.String(length=320), nullable=True)
    with op.batch_alter_table("phone_otp_challenges", schema=None) as batch_op:
        batch_op.drop_constraint("ck_phone_otp_purpose", type_="check")
        batch_op.create_check_constraint("ck_phone_otp_purpose", "purpose IN ('phone_link', 'phone_login', 'phone_registration', 'password_recovery')")

def downgrade() -> None:
    bind = op.get_bind()
    null_count = bind.execute(sa.text("SELECT COUNT(*) FROM users WHERE email IS NULL")).scalar_one()
    if null_count:
        raise RuntimeError("Cannot downgrade while phone-only accounts exist; restore an email for those accounts first.")
    with op.batch_alter_table("phone_otp_challenges", schema=None) as batch_op:
        batch_op.drop_constraint("ck_phone_otp_purpose", type_="check")
        batch_op.create_check_constraint("ck_phone_otp_purpose", "purpose IN ('phone_link', 'phone_login', 'password_recovery')")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.alter_column("email", existing_type=sa.String(length=320), nullable=False)

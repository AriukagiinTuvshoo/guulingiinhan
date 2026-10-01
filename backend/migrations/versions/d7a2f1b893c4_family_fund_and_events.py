"""Add family scoped funds, donations, events and registrations.

Revision ID: d7a2f1b893c4
Revises: c4e0a2b1d991
"""

import sqlalchemy as sa
from alembic import op

revision = "d7a2f1b893c4"
down_revision = "c4e0a2b1d991"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "family_funds",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("family_id", sa.Uuid(), sa.ForeignKey("families.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("payment_instruction", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_family_funds_family_id", "family_funds", ["family_id"])
    op.create_table(
        "donations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("family_id", sa.Uuid(), sa.ForeignKey("families.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fund_id", sa.Uuid(), sa.ForeignKey("family_funds.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("donor_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("private_donor", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("confirmed_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("amount_minor > 0", name="ck_donation_positive_amount"),
        sa.CheckConstraint("status IN ('pledged', 'reported', 'confirmed', 'cancelled')", name="ck_donation_status"),
    )
    op.create_index("ix_donation_family_created", "donations", ["family_id", "created_at"])
    op.create_table(
        "family_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("family_id", sa.Uuid(), sa.ForeignKey("families.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("location", sa.String(300), nullable=False),
        sa.Column("registration_deadline", sa.DateTime(timezone=True)),
        sa.Column("capacity", sa.Integer()),
        sa.Column("adult_fee_minor", sa.BigInteger(), nullable=False),
        sa.Column("child_fee_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("payment_instruction", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("capacity IS NULL OR capacity > 0", name="ck_family_event_positive_capacity"),
        sa.CheckConstraint("adult_fee_minor >= 0 AND child_fee_minor >= 0", name="ck_family_event_nonnegative_fees"),
    )
    op.create_index("ix_family_events_family_id", "family_events", ["family_id"])
    op.create_table(
        "event_registrations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("family_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("adult_count", sa.Integer(), nullable=False),
        sa.Column("child_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("payment_status", sa.String(12), nullable=False),
        sa.Column("confirmed_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("event_id", "user_id", name="uq_event_registration_user"),
        sa.CheckConstraint("adult_count >= 0 AND child_count >= 0 AND adult_count + child_count > 0", name="ck_event_attendee_counts"),
        sa.CheckConstraint("status IN ('registered', 'cancelled')", name="ck_event_registration_status"),
        sa.CheckConstraint("payment_status IN ('unpaid', 'reported', 'confirmed')", name="ck_event_payment_status"),
    )
    op.create_index("ix_event_registrations_event_id", "event_registrations", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_event_registrations_event_id", table_name="event_registrations")
    op.drop_table("event_registrations")
    op.drop_index("ix_family_events_family_id", table_name="family_events")
    op.drop_table("family_events")
    op.drop_index("ix_donation_family_created", table_name="donations")
    op.drop_table("donations")
    op.drop_index("ix_family_funds_family_id", table_name="family_funds")
    op.drop_table("family_funds")

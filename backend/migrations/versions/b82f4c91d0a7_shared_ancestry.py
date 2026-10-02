"""Add opt-in shared ancestry root and cross-family descendants."""

import sqlalchemy as sa
from alembic import op

revision = "b82f4c91d0a7"
down_revision = "d8150b6a9e3c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shared_ancestry",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("root_person_id", sa.Uuid(), sa.ForeignKey("persons.id", ondelete="RESTRICT")),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_shared_ancestry_singleton"),
    )
    op.create_table(
        "shared_ancestry_persons",
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("persons.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("family_id", sa.Uuid(), sa.ForeignKey("families.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("shared_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_shared_ancestry_person_family", "shared_ancestry_persons", ["family_id"])
    op.create_table(
        "shared_ancestry_relationships",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("parent_id", sa.Uuid(), sa.ForeignKey("persons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("child_id", sa.Uuid(), sa.ForeignKey("persons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relationship_type", sa.String(16), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("parent_id", "child_id", name="uq_shared_ancestry_parent_child"),
        sa.CheckConstraint("parent_id <> child_id", name="ck_shared_ancestry_not_self"),
        sa.CheckConstraint("relationship_type IN ('biological', 'adoptive', 'step')", name="ck_shared_ancestry_relationship_type"),
    )
    op.create_index("ix_shared_ancestry_relationship_child", "shared_ancestry_relationships", ["child_id"])
    op.create_table(
        "shared_donation_info",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("bank_name", sa.String(120), nullable=False),
        sa.Column("account_name", sa.String(180), nullable=False),
        sa.Column("account_number", sa.String(80), nullable=False),
        sa.Column("qr_image_url", sa.String(1000)),
        sa.Column("is_published", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_shared_donation_info_singleton"),
        sa.CheckConstraint("length(currency) = 3", name="ck_shared_donation_currency"),
    )


def downgrade() -> None:
    op.drop_table("shared_donation_info")
    op.drop_index("ix_shared_ancestry_relationship_child", table_name="shared_ancestry_relationships")
    op.drop_table("shared_ancestry_relationships")
    op.drop_index("ix_shared_ancestry_person_family", table_name="shared_ancestry_persons")
    op.drop_table("shared_ancestry_persons")
    op.drop_table("shared_ancestry")

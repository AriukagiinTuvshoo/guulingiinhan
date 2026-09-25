"""add explicit lineage and branch domain foundation

Revision ID: 6d2f9c4e7a11
Revises: c441b2f3a805
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from alembic import op

revision = "6d2f9c4e7a11"
down_revision = "c441b2f3a805"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lineages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("family_id", "name", name="uq_lineage_family_name"),
    )
    op.create_table(
        "branches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lineage_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["lineage_id"], ["lineages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lineage_id", "name", name="uq_branch_lineage_name"),
    )
    op.create_index("ix_lineages_family_id", "lineages", ["family_id"])
    op.create_index("ix_branches_lineage_id", "branches", ["lineage_id"])


def downgrade() -> None:
    op.drop_index("ix_branches_lineage_id", table_name="branches")
    op.drop_index("ix_lineages_family_id", table_name="lineages")
    op.drop_table("branches")
    op.drop_table("lineages")

"""add explicit current person lineage assignments

Revision ID: 8e3a1b7c5d42
Revises: 6d2f9c4e7a11
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from alembic import op

revision = "8e3a1b7c5d42"
down_revision = "6d2f9c4e7a11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "person_lineage_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.Column("lineage_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["person_id"], ["persons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lineage_id"], ["lineages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("person_id", name="uq_person_lineage_assignment_person"),
    )
    op.create_index(
        "ix_person_lineage_assignment_lineage",
        "person_lineage_assignments",
        ["lineage_id"],
    )
    op.create_index(
        "ix_person_lineage_assignment_branch",
        "person_lineage_assignments",
        ["branch_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_person_lineage_assignment_branch", table_name="person_lineage_assignments")
    op.drop_index(
        "ix_person_lineage_assignment_lineage",
        table_name="person_lineage_assignments",
    )
    op.drop_table("person_lineage_assignments")

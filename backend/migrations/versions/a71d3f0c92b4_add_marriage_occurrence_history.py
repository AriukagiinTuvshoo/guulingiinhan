"""allow repeated marriage occurrences and index per-person history

Revision ID: a71d3f0c92b4
Revises: 9b36d2c718fa
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

revision = "a71d3f0c92b4"
down_revision = "9b36d2c718fa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Pair uniqueness previously made a second marriage to the same person impossible.
    # Rebuild only this table constraint; all existing rows and foreign keys are retained.
    with op.batch_alter_table("marriages") as batch_op:
        batch_op.drop_constraint("uq_marriage_pair", type_="unique")

    # Prevent duplicate active occurrences while retaining any number of ended records.
    op.create_index(
        "uq_marriage_pair_active",
        "marriages",
        ["person_1_id", "person_2_id"],
        unique=True,
        sqlite_where=sa.text("status = 'married' AND deleted_at IS NULL"),
        postgresql_where=sa.text("status = 'married' AND deleted_at IS NULL"),
    )
    op.create_index(
        "ix_marriage_person_1_start", "marriages", ["person_1_id", "start_date", "created_at"]
    )
    op.create_index(
        "ix_marriage_person_2_start", "marriages", ["person_2_id", "start_date", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_marriage_person_2_start", table_name="marriages")
    op.drop_index("ix_marriage_person_1_start", table_name="marriages")
    op.drop_index("uq_marriage_pair_active", table_name="marriages")
    # This downgrade is intentionally data-preserving. It will fail if repeated pair
    # occurrences have since been recorded, because those rows cannot fit the old schema.
    with op.batch_alter_table("marriages") as batch_op:
        batch_op.create_unique_constraint("uq_marriage_pair", ["person_1_id", "person_2_id"])

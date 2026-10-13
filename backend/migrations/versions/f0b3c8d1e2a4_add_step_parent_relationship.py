"""Distinguish step-parent links from biological and adoptive ancestry."""

from alembic import op
from sqlalchemy import text

revision = "f0b3c8d1e2a4"
down_revision = "c42e8d19a7b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("parent_child_relationships") as batch:
        batch.drop_constraint("ck_parent_child_type", type_="check")
        batch.create_check_constraint(
            "ck_parent_child_type", "relationship_type IN ('biological', 'adoptive', 'step')"
        )


def downgrade() -> None:
    if op.get_bind().execute(
        text("SELECT 1 FROM parent_child_relationships WHERE relationship_type = 'step' LIMIT 1")
    ).first():
        raise RuntimeError("Step-parent links must be reviewed before downgrading.")
    with op.batch_alter_table("parent_child_relationships") as batch:
        batch.drop_constraint("ck_parent_child_type", type_="check")
        batch.create_check_constraint(
            "ck_parent_child_type", "relationship_type IN ('biological', 'adoptive')"
        )

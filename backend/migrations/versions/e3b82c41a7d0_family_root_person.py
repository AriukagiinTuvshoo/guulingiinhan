"""Allow a Family owner to designate an existing canonical root Person.

Revision ID: e3b82c41a7d0
Revises: d7a2f1b893c4
"""

import sqlalchemy as sa
from alembic import op

revision = "e3b82c41a7d0"
down_revision = "d7a2f1b893c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("families") as batch_op:
        batch_op.add_column(
            sa.Column(
                "root_person_id",
                sa.Uuid(),
                sa.ForeignKey("persons.id", ondelete="RESTRICT", name="fk_families_root_person_id_persons"),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("families") as batch_op:
        batch_op.drop_column("root_person_id")

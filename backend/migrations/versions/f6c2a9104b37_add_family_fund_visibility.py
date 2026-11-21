"""Add explicit family/public scope to family funds.

Revision ID: f6c2a9104b37
Revises: d11a6e28f901
"""

import sqlalchemy as sa
from alembic import op

revision = "f6c2a9104b37"
down_revision = "d11a6e28f901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("family_funds") as batch:
        batch.add_column(
            sa.Column("visibility", sa.String(length=8), nullable=False, server_default="family")
        )
        batch.create_check_constraint(
            "ck_family_fund_visibility", "visibility IN ('family', 'public')"
        )


def downgrade() -> None:
    with op.batch_alter_table("family_funds") as batch:
        batch.drop_constraint("ck_family_fund_visibility", type_="check")
        batch.drop_column("visibility")

"""Store a family-selected canonical Person as the lineage root."""

import sqlalchemy as sa
from alembic import op

revision = "a31e6d7f42c0"
down_revision = "df1fecd80312"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("families") as batch:
        batch.add_column(sa.Column("root_person_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_family_root_person", "persons", ["root_person_id"], ["id"], ondelete="SET NULL"
        )
    op.create_table(
        "person_link_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("family_id", sa.Uuid(), sa.ForeignKey("families.id", ondelete="CASCADE"), nullable=False),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("persons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("decided_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="ck_person_link_request_status"),
    )
    op.create_index("ix_person_link_request_family_status", "person_link_requests", ["family_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_person_link_request_family_status", "person_link_requests")
    op.drop_table("person_link_requests")
    with op.batch_alter_table("families") as batch:
        batch.drop_constraint("fk_family_root_person", type_="foreignkey")
        batch.drop_column("root_person_id")

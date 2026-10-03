"""Record explicit reviewed Family connections to the shared root."""

import sqlalchemy as sa
from alembic import op

revision = "a10e4c7b2d91"
down_revision = "e84b05c7a96d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "root_connections",
        sa.Column("family_id", sa.Uuid(), sa.ForeignKey("families.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("persons.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("target_person_id", sa.Uuid(), sa.ForeignKey("persons.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("relationship_type", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("requested_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("decided_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("canonical_edge_id", sa.Uuid(), sa.ForeignKey("parent_child_relationships.id", ondelete="SET NULL"), nullable=True),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected', 'disconnected')", name="ck_root_connection_status"),
        sa.CheckConstraint("relationship_type IN ('biological', 'adoptive', 'step')", name="ck_root_connection_relationship_type"),
        sa.CheckConstraint("person_id <> target_person_id", name="ck_root_connection_not_self"),
    )
    op.create_index("ix_root_connection_target", "root_connections", ["target_person_id"])
    op.create_index("ix_root_connection_status", "root_connections", ["status"])


def downgrade() -> None:
    op.drop_index("ix_root_connection_status", table_name="root_connections")
    op.drop_index("ix_root_connection_target", table_name="root_connections")
    op.drop_table("root_connections")

"""Add tree_join_requests table for member self-registration to the family tree.

Revision ID: d8e2f4a1b6c9
Revises: c7f1a2b3d4e5
Create Date: 2026-11-23

"""

import sqlalchemy as sa
from alembic import op

revision = "d8e2f4a1b6c9"
down_revision = "c7f1a2b3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if "tree_join_requests" not in tables:
        op.create_table(
            "tree_join_requests",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("family_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("first_name", sa.String(length=120), nullable=False),
            sa.Column("last_name", sa.String(length=120), nullable=False, server_default=""),
            sa.Column("middle_name", sa.String(length=120), nullable=True),
            sa.Column("gender", sa.String(length=16), nullable=True),
            sa.Column("birth_date", sa.Date(), nullable=True),
            sa.Column("birth_place", sa.String(length=200), nullable=True),
            sa.Column("biography", sa.Text(), nullable=True),
            sa.Column("branch_id", sa.Uuid(), nullable=True),
            sa.Column("claimed_generation", sa.Integer(), nullable=True),
            sa.Column("father_person_id", sa.Uuid(), nullable=True),
            sa.Column("mother_person_id", sa.Uuid(), nullable=True),
            sa.Column("declared_father_name", sa.String(length=160), nullable=True),
            sa.Column("declared_mother_name", sa.String(length=160), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
            sa.Column("created_person_id", sa.Uuid(), nullable=True),
            sa.Column("reviewed_by", sa.Uuid(), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("review_note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "gender IS NULL OR gender IN ('male', 'female', 'other')",
                name="ck_tree_join_request_gender",
            ),
            sa.CheckConstraint(
                "claimed_generation IS NULL OR (claimed_generation >= 1 AND claimed_generation <= 15)",
                name="ck_tree_join_request_generation",
            ),
            sa.CheckConstraint(
                "status IN ('pending', 'approved', 'rejected')",
                name="ck_tree_join_request_status",
            ),
            sa.CheckConstraint(
                "father_person_id IS NULL OR mother_person_id IS NULL OR father_person_id <> mother_person_id",
                name="ck_tree_join_request_distinct_parents",
            ),
            sa.ForeignKeyConstraint(["family_id"], ["families.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["father_person_id"], ["persons.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["mother_person_id"], ["persons.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["created_person_id"], ["persons.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_tree_join_requests_family_id", "tree_join_requests", ["family_id"])
        op.create_index("ix_tree_join_requests_user_id", "tree_join_requests", ["user_id"])
        op.create_index(
            "ix_tree_join_request_family_status",
            "tree_join_requests",
            ["family_id", "status", "created_at"],
        )
        op.create_index(
            "uq_tree_join_request_pending_user",
            "tree_join_requests",
            ["family_id", "user_id"],
            unique=True,
            sqlite_where=sa.text("status = 'pending'"),
            postgresql_where=sa.text("status = 'pending'"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if "tree_join_requests" in tables:
        op.drop_table("tree_join_requests")

"""Establish the family archive foundation domain.

Revision ID: f4a7c2d9e611
Revises: e7c4a19d5f20
"""

import sqlalchemy as sa
from alembic import op

revision = "f4a7c2d9e611"
down_revision = "e7c4a19d5f20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "archives",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("document_date", sa.Date(), nullable=True),
        sa.Column("place", sa.String(length=240), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("visibility", sa.String(length=12), nullable=False, server_default="family"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "visibility IN ('private', 'family', 'public')",
            name="ck_archive_visibility",
        ),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "family_id", name="uq_archive_family"),
    )
    op.create_index("ix_archives_family_id", "archives", ["family_id"])
    op.create_index("ix_archive_family_created", "archives", ["family_id", "created_at"])
    op.create_index("ix_archive_family_document_date", "archives", ["family_id", "document_date"])
    op.create_index("ix_archive_family_title", "archives", ["family_id", "title"])

    op.create_table(
        "archive_persons",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("archive_id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["archive_id", "family_id"],
            ["archives.id", "archives.family_id"],
            name="fk_archive_person_archive_family",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["family_id", "person_id"],
            ["family_persons.family_id", "family_persons.person_id"],
            name="fk_archive_person_family_person",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("archive_id", "person_id", name="uq_archive_person"),
    )
    op.create_index("ix_archive_person_family_id", "archive_persons", ["family_id"])
    op.create_index("ix_archive_person_person", "archive_persons", ["person_id"])


def downgrade() -> None:
    op.drop_index("ix_archive_person_person", table_name="archive_persons")
    op.drop_index("ix_archive_person_family_id", table_name="archive_persons")
    op.drop_table("archive_persons")
    op.drop_index("ix_archive_family_title", table_name="archives")
    op.drop_index("ix_archive_family_document_date", table_name="archives")
    op.drop_index("ix_archive_family_created", table_name="archives")
    op.drop_index("ix_archives_family_id", table_name="archives")
    op.drop_table("archives")

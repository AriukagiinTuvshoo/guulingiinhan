"""Establish the family story domain.

Revision ID: e7c4a19d5f20
Revises: 8e3a1b7c5d42
"""
import sqlalchemy as sa
from alembic import op

revision = "e7c4a19d5f20"
down_revision = "8e3a1b7c5d42"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=True),
        sa.Column("place", sa.String(length=240), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("visibility", sa.String(length=12), nullable=False, server_default="family"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "family_id", name="uq_story_family"),
        sa.CheckConstraint(
            "visibility IN ('private', 'family', 'public')",
            name="ck_story_visibility",
        ),
    )
    op.create_index("ix_stories_family_id", "stories", ["family_id"])
    op.create_index("ix_story_family_created", "stories", ["family_id", "created_at"])
    op.create_index("ix_story_family_event_date", "stories", ["family_id", "event_date"])

    op.create_table(
        "story_persons",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("story_id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["story_id", "family_id"],
            ["stories.id", "stories.family_id"],
            name="fk_story_person_story_family",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["family_id", "person_id"],
            ["family_persons.family_id", "family_persons.person_id"],
            name="fk_story_person_family_person",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("story_id", "person_id", name="uq_story_person"),
    )
    op.create_index("ix_story_person_family_id", "story_persons", ["family_id"])
    op.create_index("ix_story_person_person", "story_persons", ["person_id"])


def downgrade() -> None:
    op.drop_index("ix_story_person_person", table_name="story_persons")
    op.drop_index("ix_story_person_family_id", table_name="story_persons")
    op.drop_table("story_persons")
    op.drop_index("ix_story_family_event_date", table_name="stories")
    op.drop_index("ix_story_family_created", table_name="stories")
    op.drop_index("ix_stories_family_id", table_name="stories")
    op.drop_table("stories")

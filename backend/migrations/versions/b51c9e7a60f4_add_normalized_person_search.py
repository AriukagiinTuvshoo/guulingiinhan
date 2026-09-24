"""add indexed unicode-normalized person search fields

Revision ID: b51c9e7a60f4
Revises: a71d3f0c92b4
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from alembic import op

from app.person_search import normalize_search_name

revision = "b51c9e7a60f4"
down_revision = "a71d3f0c92b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "persons",
        sa.Column("search_first_name", sa.String(length=120), server_default="", nullable=False),
    )
    op.add_column(
        "persons",
        sa.Column("search_last_name", sa.String(length=120), server_default="", nullable=False),
    )
    op.add_column(
        "persons",
        sa.Column("search_middle_name", sa.String(length=120), server_default="", nullable=False),
    )

    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id, first_name, last_name, middle_name FROM persons")
    ).mappings()
    updates = [
        {
            "id": row["id"],
            "first": normalize_search_name(row["first_name"]),
            "last": normalize_search_name(row["last_name"]),
            "middle": normalize_search_name(row["middle_name"]),
        }
        for row in rows
    ]
    if updates:
        connection.execute(
            sa.text(
                "UPDATE persons SET search_first_name = :first, "
                "search_last_name = :last, search_middle_name = :middle WHERE id = :id"
            ),
            updates,
        )

    op.create_index(
        "ix_person_search_first",
        "persons",
        ["search_first_name"],
        postgresql_ops={"search_first_name": "text_pattern_ops"},
    )
    op.create_index(
        "ix_person_search_last",
        "persons",
        ["search_last_name"],
        postgresql_ops={"search_last_name": "text_pattern_ops"},
    )
    op.create_index(
        "ix_person_search_middle",
        "persons",
        ["search_middle_name"],
        postgresql_ops={"search_middle_name": "text_pattern_ops"},
    )
    op.create_index("ix_person_birth_date", "persons", ["birth_date"])


def downgrade() -> None:
    op.drop_index("ix_person_birth_date", table_name="persons")
    op.drop_index("ix_person_search_middle", table_name="persons")
    op.drop_index("ix_person_search_last", table_name="persons")
    op.drop_index("ix_person_search_first", table_name="persons")
    op.drop_column("persons", "search_middle_name")
    op.drop_column("persons", "search_last_name")
    op.drop_column("persons", "search_first_name")

"""Merge the phone-registration and family-archive migration heads.

Revision ID: a6b8c1d4e2f0
Revises: 9f4c2d7e8a31, f4a7c2d9e611
Create Date: 2026-09-26
"""

from alembic import op


revision = "a6b8c1d4e2f0"
down_revision = ("9f4c2d7e8a31", "f4a7c2d9e611")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

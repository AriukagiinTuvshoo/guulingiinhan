"""Add chat_messages table for family messenger.

Revision ID: c7f1a2b3d4e5
Revises: a3f7c5d90e1b
Create Date: 2026-11-22

"""

import sqlalchemy as sa
from alembic import op

revision = "c7f1a2b3d4e5"
down_revision = "a3f7c5d90e1b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if "chat_messages" not in tables:
        op.create_table(
            "chat_messages",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("family_id", sa.Uuid(), nullable=False),
            sa.Column("sender_id", sa.Uuid(), nullable=False),
            sa.Column("recipient_id", sa.Uuid(), nullable=True),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["family_id"], ["families.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["recipient_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_chat_messages_family_id", "chat_messages", ["family_id"])
        op.create_index("ix_chat_messages_sender_id", "chat_messages", ["sender_id"])
        op.create_index("ix_chat_messages_recipient_id", "chat_messages", ["recipient_id"])
        op.create_index(
            "ix_chat_messages_family_created", "chat_messages", ["family_id", "created_at"]
        )
        op.create_index(
            "ix_chat_messages_direct",
            "chat_messages",
            ["family_id", "sender_id", "recipient_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if "chat_messages" in tables:
        op.drop_table("chat_messages")

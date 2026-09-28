"""enforce one active invitation per family and email
Revision ID: a2b7c9d1e3f5
Revises: 9f4c2d7e8a31
"""
import sqlalchemy as sa
from alembic import op
revision = "a2b7c9d1e3f5"
down_revision = "9f4c2d7e8a31"
branch_labels = None
depends_on = None

def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, family_id, invited_email, created_at FROM invitations "
        "WHERE accepted_at IS NULL AND revoked_at IS NULL "
        "ORDER BY family_id, invited_email, created_at DESC, id DESC"
    )).mappings().all()
    seen = set()
    for row in rows:
        key = (str(row["family_id"]), row["invited_email"])
        if key in seen:
            bind.execute(
                sa.text("UPDATE invitations SET revoked_at = CURRENT_TIMESTAMP WHERE id = :id"),
                {"id": row["id"]},
            )
        else:
            seen.add(key)
    op.create_index(
        "uq_invitation_active_family_email",
        "invitations",
        ["family_id", "invited_email"],
        unique=True,
        sqlite_where=sa.text("accepted_at IS NULL AND revoked_at IS NULL"),
        postgresql_where=sa.text("accepted_at IS NULL AND revoked_at IS NULL"),
    )

def downgrade() -> None:
    op.drop_index("uq_invitation_active_family_email", table_name="invitations")

"""Add reversible household-to-clan links and normalize the admin grant scope check.

Revision ID: f4c19a7b3d20
Revises: e8b32f901a6d

The scope-check repair is required because revision ``c7a4e8d901b2`` was edited to
admit ``manage_settings`` while it was still an uncommitted draft. A database that
already applied the earlier text keeps the narrower constraint and Alembic will not
revisit it, so a forward-only reconciliation is the safe fix; no applied revision is
rewritten and no downgrade is needed.
"""
import sqlalchemy as sa
from alembic import op

revision = "f4c19a7b3d20"
down_revision = "e8b32f901a6d"
branch_labels = None
depends_on = None

GRANT_SCOPE_SQL = "scope IN ('view_audit', 'manage_trash', 'manage_settings')"


def _grant_scope_constraint_is_stale(bind) -> bool:
    """True only when the existing check constraint cannot admit ``manage_settings``."""
    inspector = sa.inspect(bind)
    if "family_admin_grants" not in inspector.get_table_names():
        return False
    for check in inspector.get_check_constraints("family_admin_grants"):
        if check["name"] == "ck_family_admin_grant_scope":
            return "manage_settings" not in str(check.get("sqltext", ""))
    return False


def upgrade() -> None:
    op.create_table(
        "family_clan_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "household_family_id",
            sa.Uuid(),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "clan_family_id",
            sa.Uuid(),
            sa.ForeignKey("families.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "household_person_id",
            sa.Uuid(),
            sa.ForeignKey("persons.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "clan_anchor_person_id",
            sa.Uuid(),
            sa.ForeignKey("persons.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("relation", sa.String(16), nullable=False),
        sa.Column(
            "created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("household_family_id", name="uq_family_clan_link_household"),
        sa.CheckConstraint(
            "relation IN ('child_of', 'parent_of', 'spouse_of')",
            name="ck_family_clan_link_relation",
        ),
        sa.CheckConstraint(
            "household_family_id <> clan_family_id", name="ck_family_clan_link_not_self"
        ),
    )
    op.create_index(
        "ix_family_clan_links_clan_family", "family_clan_links", ["clan_family_id"], unique=False
    )

    if _grant_scope_constraint_is_stale(op.get_bind()):
        with op.batch_alter_table("family_admin_grants") as batch_op:
            batch_op.drop_constraint("ck_family_admin_grant_scope", type_="check")
            batch_op.create_check_constraint("ck_family_admin_grant_scope", GRANT_SCOPE_SQL)


def downgrade() -> None:
    # The grant-scope repair is intentionally not reversed: narrowing a deployed
    # constraint again would strand rows that already hold manage_settings.
    op.drop_index("ix_family_clan_links_clan_family", table_name="family_clan_links")
    op.drop_table("family_clan_links")

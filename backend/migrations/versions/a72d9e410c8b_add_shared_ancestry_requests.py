"""Review shared-tree changes separately for each canonical Person.

Revision ID: a72d9e410c8b
Revises: f6c2a9104b37
"""

import sqlalchemy as sa
from alembic import op

revision = "a72d9e410c8b"
down_revision = "f6c2a9104b37"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shared_ancestry_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("family_id", sa.Uuid(), sa.ForeignKey("families.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("person_id", sa.Uuid(), sa.ForeignKey("persons.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("target_person_id", sa.Uuid(), sa.ForeignKey("persons.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("relationship_type", sa.String(16), nullable=True),
        sa.Column("status", sa.String(9), nullable=False, server_default="pending"),
        sa.Column("requested_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("decided_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("canonical_edge_id", sa.Uuid(), sa.ForeignKey("parent_child_relationships.id", ondelete="SET NULL"), nullable=True),
        sa.Column("canonical_marriage_id", sa.Uuid(), sa.ForeignKey("marriages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("consented_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('child', 'spouse', 'detach')", name="ck_shared_request_kind"),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected', 'cancelled')", name="ck_shared_request_status"),
        sa.CheckConstraint(
            "(kind = 'child' AND target_person_id IS NOT NULL AND relationship_type IS NOT NULL AND relationship_type IN ('biological', 'adoptive', 'step')) OR "
            "(kind = 'spouse' AND target_person_id IS NOT NULL AND relationship_type IS NOT NULL AND relationship_type IN ('married', 'widowed')) OR "
            "(kind = 'detach' AND target_person_id IS NULL AND relationship_type IS NULL)",
            name="ck_shared_request_relationship",
        ),
        sa.CheckConstraint("target_person_id IS NULL OR person_id <> target_person_id", name="ck_shared_request_not_self"),
        sa.CheckConstraint("kind = 'detach' OR consented_at IS NOT NULL", name="ck_shared_request_consent"),
    )
    op.create_index("ix_shared_request_family_requester", "shared_ancestry_requests",
                    ["family_id", "requested_by", "requested_at"])
    op.create_index("ix_shared_request_status", "shared_ancestry_requests", ["status", "requested_at"])
    op.create_index("uq_shared_request_pending_person", "shared_ancestry_requests", ["person_id"], unique=True,
                    sqlite_where=sa.text("status = 'pending'"), postgresql_where=sa.text("status = 'pending'"))
    if op.get_bind().dialect.name == "postgresql":
        # Only the existing private FastAPI role receives access. No Supabase
        # Data API role or end-user policy can read another person's request.
        op.execute("ALTER TABLE shared_ancestry_requests ENABLE ROW LEVEL SECURITY")
        op.execute("REVOKE ALL ON TABLE shared_ancestry_requests FROM PUBLIC")
        op.execute("""DO $shared_requests$ DECLARE role_record record; BEGIN
            FOR role_record IN SELECT rolname FROM pg_roles
                WHERE rolname IN ('anon', 'authenticated', 'service_role')
            LOOP
                EXECUTE format('REVOKE ALL ON TABLE shared_ancestry_requests FROM %I', role_record.rolname);
            END LOOP;
            FOR role_record IN SELECT rolname FROM pg_roles
                WHERE rolcanlogin AND rolname ~ '^guulingiinhan(_[a-z0-9]+)*_app$'
                  AND has_table_privilege(rolname, 'root_connections', 'SELECT')
                  AND has_table_privilege(rolname, 'root_connections', 'INSERT')
            LOOP
                EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE shared_ancestry_requests TO %I', role_record.rolname);
                EXECUTE format('CREATE POLICY %I ON shared_ancestry_requests FOR ALL TO %I USING (true) WITH CHECK (true)',
                               'shared_requests_' || role_record.rolname, role_record.rolname);
            END LOOP;
        END $shared_requests$;""")


def downgrade() -> None:
    op.drop_table("shared_ancestry_requests")

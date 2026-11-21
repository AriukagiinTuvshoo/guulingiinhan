"""Allow the dedicated application database role to use root connections."""

from alembic import op

revision = "b10c8e621f4a"
down_revision = "a10e4c7b2d91"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    # The web API uses a dedicated login role, not the migration owner. Keep
    # Supabase Data API roles without table privileges or an RLS policy.
    op.execute("DROP POLICY IF EXISTS root_connections_staging_app_access ON root_connections")
    op.execute("""
        DO $p10$
        DECLARE app_role record;
        BEGIN
          FOR app_role IN
            SELECT rolname FROM pg_roles
            WHERE rolcanlogin
              AND rolname ~ '^guulingiinhan(_[a-z0-9]+)*_app$'
              AND has_table_privilege(rolname, 'persons', 'SELECT')
              AND has_table_privilege(rolname, 'parent_child_relationships', 'INSERT')
          LOOP
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE root_connections TO %I', app_role.rolname);
            EXECUTE format('DROP POLICY IF EXISTS %I ON root_connections',
                           'root_connections_' || app_role.rolname);
            EXECUTE format('CREATE POLICY %I ON root_connections FOR ALL TO %I USING (true) WITH CHECK (true)',
                           'root_connections_' || app_role.rolname, app_role.rolname);
          END LOOP;
        END
        $p10$
    """)


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("""
        DO $p10$
        DECLARE app_role record;
        BEGIN
          FOR app_role IN
            SELECT rolname FROM pg_roles WHERE rolname ~ '^guulingiinhan(_[a-z0-9]+)*_app$'
          LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON root_connections',
                           'root_connections_' || app_role.rolname);
            EXECUTE format('REVOKE ALL ON TABLE root_connections FROM %I', app_role.rolname);
          END LOOP;
        END
        $p10$
    """)

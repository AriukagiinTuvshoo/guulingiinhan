"""Persist memory interactions and an optional canonical featured Person.

Existing memories, family relationships and sharing settings are untouched.
"""
import sqlalchemy as sa
from alembic import op

revision = "d11a6e28f901"
down_revision = "c16a4e8b9021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("families") as batch:
        batch.add_column(sa.Column("featured_person_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key("fk_family_featured_person", "persons", ["featured_person_id"],
                                 ["id"], ondelete="SET NULL")
    op.create_table("memory_likes",
        sa.Column("memory_id", sa.Uuid(), sa.ForeignKey("memories.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("memory_comments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("memory_id", sa.Uuid(), sa.ForeignKey("memories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_key", sa.Uuid(), nullable=False),
        sa.Column("body", sa.String(2000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("memory_id", "user_id", "request_key", name="uq_memory_comment_request"),
        sa.CheckConstraint("length(body) > 0 AND length(body) <= 2000", name="ck_memory_comment_body"))
    op.create_index("ix_memory_comment_page", "memory_comments", ["memory_id", "created_at", "id"])
    if op.get_bind().dialect.name == "postgresql":
        # Keep Supabase Data API roles without privileges or policies. The
        # private FastAPI login role uses the same boundary as root_connections.
        # Plain literals only (bandit B608): table names are baked in rather
        # than interpolated into SQL at runtime. The statements are otherwise
        # byte-identical to the previous loop-generated versions.
        op.execute("ALTER TABLE memory_likes ENABLE ROW LEVEL SECURITY")
        op.execute("""DO $p11$ DECLARE role_record record; BEGIN
                FOR role_record IN SELECT rolname FROM pg_roles
                    WHERE rolname IN ('anon', 'authenticated', 'service_role')
                LOOP
                    EXECUTE format('REVOKE ALL ON TABLE memory_likes FROM %I', role_record.rolname);
                END LOOP;
                FOR role_record IN SELECT rolname FROM pg_roles
                    WHERE rolcanlogin AND rolname ~ '^guulingiinhan(_[a-z0-9]+)*_app$'
                      AND has_table_privilege(rolname, 'memories', 'SELECT')
                      AND has_table_privilege(rolname, 'memories', 'INSERT')
                LOOP
                    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE memory_likes TO %I', role_record.rolname);
                    EXECUTE format('CREATE POLICY %I ON memory_likes FOR ALL TO %I USING (true) WITH CHECK (true)',
                                   'memory_likes_' || role_record.rolname, role_record.rolname);
                END LOOP;
            END $p11$;""")
        op.execute("ALTER TABLE memory_comments ENABLE ROW LEVEL SECURITY")
        op.execute("""DO $p11$ DECLARE role_record record; BEGIN
                FOR role_record IN SELECT rolname FROM pg_roles
                    WHERE rolname IN ('anon', 'authenticated', 'service_role')
                LOOP
                    EXECUTE format('REVOKE ALL ON TABLE memory_comments FROM %I', role_record.rolname);
                END LOOP;
                FOR role_record IN SELECT rolname FROM pg_roles
                    WHERE rolcanlogin AND rolname ~ '^guulingiinhan(_[a-z0-9]+)*_app$'
                      AND has_table_privilege(rolname, 'memories', 'SELECT')
                      AND has_table_privilege(rolname, 'memories', 'INSERT')
                LOOP
                    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE memory_comments TO %I', role_record.rolname);
                    EXECUTE format('CREATE POLICY %I ON memory_comments FOR ALL TO %I USING (true) WITH CHECK (true)',
                                   'memory_comments_' || role_record.rolname, role_record.rolname);
                END LOOP;
            END $p11$;""")



def downgrade() -> None:
    op.drop_table("memory_comments")
    op.drop_table("memory_likes")
    with op.batch_alter_table("families") as batch:
        batch.drop_constraint("fk_family_featured_person", type_="foreignkey")
        batch.drop_column("featured_person_id")

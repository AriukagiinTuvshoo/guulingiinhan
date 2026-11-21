"""merge line-B shared-ancestry chain into main chain

Revision ID: a3f7c5d90e1b
Revises: 6b31cc42c423, a72d9e410c8b
Create Date: 2026-11-20

Reconciles the two heads introduced by integrating the
codex/integration-regression-2026-10-02 line: main's remediation
chain (6b31cc42c423) and line B's shared-ancestry chain
(a72d9e410c8b). Both chains are schema-compatible; this revision
only merges the graph so future migrations have a single head.
"""

revision = "a3f7c5d90e1b"
down_revision = ("6b31cc42c423", "a72d9e410c8b")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

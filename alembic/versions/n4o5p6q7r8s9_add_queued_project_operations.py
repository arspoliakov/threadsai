"""add queued project operations

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-05-27 03:30:00.000000
"""

from collections.abc import Sequence

from alembic import op


revision: str = "n4o5p6q7r8s9"
down_revision: str | None = "m3n4o5p6q7r8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE projectoperationstatus ADD VALUE IF NOT EXISTS 'queued'")


def downgrade() -> None:
    # SQLite stores SQLAlchemy enums as strings here. PostgreSQL enum value removal
    # is intentionally not attempted because it requires recreating the enum type.
    pass

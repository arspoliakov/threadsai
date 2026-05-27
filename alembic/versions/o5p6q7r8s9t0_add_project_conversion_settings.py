"""add project conversion settings

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
Create Date: 2026-05-27 16:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "o5p6q7r8s9t0"
down_revision: str | None = "n4o5p6q7r8s9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(sa.Column("conversion_mode", sa.String(length=32), nullable=False, server_default="bio_link"))
        batch_op.add_column(sa.Column("conversion_target", sa.Text(), nullable=True))

    with op.batch_alter_table("projects") as batch_op:
        batch_op.alter_column("conversion_mode", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("conversion_target")
        batch_op.drop_column("conversion_mode")

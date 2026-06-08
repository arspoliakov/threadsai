"""add project conversion intensity

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-06-08 16:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "t0u1v2w3x4y5"
down_revision: str | None = "s9t0u1v2w3x4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(
            sa.Column("conversion_intensity", sa.Integer(), nullable=False, server_default="25")
        )

    with op.batch_alter_table("projects") as batch_op:
        batch_op.alter_column("conversion_intensity", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("conversion_intensity")

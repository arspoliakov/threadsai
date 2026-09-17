"""add complimentary subscription access

Revision ID: z6a7b8c9d0e1
Revises: y5z6a7b8c9d0
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "z6a7b8c9d0e1"
down_revision: str | None = "y5z6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("complimentary_access_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("complimentary_access_plan", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("complimentary_access_reason", sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("complimentary_access_reason")
        batch_op.drop_column("complimentary_access_plan")
        batch_op.drop_column("complimentary_access_expires_at")

"""add project schedule settings

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-05-23 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op


revision: str = "j0k1l2m3n4o5"
down_revision: Union[str, None] = "i9j0k1l2m3n4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(sa.Column("posts_per_day", sa.Integer(), nullable=False, server_default="3"))
        batch_op.add_column(sa.Column("active_hours_start", sa.String(length=5), nullable=False, server_default="09:00"))
        batch_op.add_column(sa.Column("active_hours_end", sa.String(length=5), nullable=False, server_default="21:00"))
        batch_op.add_column(sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Europe/Moscow"))


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("timezone")
        batch_op.drop_column("active_hours_end")
        batch_op.drop_column("active_hours_start")
        batch_op.drop_column("posts_per_day")

"""add saved trend reverse engineering fields

Revision ID: a1b2c3d4e5f6
Revises: 53d2dbc9b349
Create Date: 2026-05-20 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "53d2dbc9b349"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("saved_trends", sa.Column("hook_mechanic", sa.Text(), nullable=True))
    op.add_column("saved_trends", sa.Column("structure_pattern", sa.Text(), nullable=True))
    op.add_column("saved_trends", sa.Column("tone_and_rhythm", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("saved_trends", "tone_and_rhythm")
    op.drop_column("saved_trends", "structure_pattern")
    op.drop_column("saved_trends", "hook_mechanic")

"""add trend dna fields

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-05-23 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "saved_trends",
        sa.Column("living_phrases", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "saved_trends",
        sa.Column("semantic_forbidden_zone", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("saved_trends", "semantic_forbidden_zone")
    op.drop_column("saved_trends", "living_phrases")

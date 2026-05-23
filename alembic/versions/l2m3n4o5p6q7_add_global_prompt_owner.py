"""add global prompt owner

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-05-23 20:05:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "l2m3n4o5p6q7"
down_revision: str | None = "k1l2m3n4o5p6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("global_prompts", sa.Column("owner_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_global_prompts_owner_id"), "global_prompts", ["owner_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_global_prompts_owner_id"), table_name="global_prompts")
    op.drop_column("global_prompts", "owner_id")

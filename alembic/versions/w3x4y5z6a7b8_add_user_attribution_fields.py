"""add user attribution fields

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-08-31 03:55:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "w3x4y5z6a7b8"
down_revision: str | None = "v2w3x4y5z6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("first_landing_path", sa.String(length=2048), nullable=True))
    op.add_column("users", sa.Column("first_referrer", sa.String(length=2048), nullable=True))
    op.add_column("users", sa.Column("first_utm_json", sa.JSON(), nullable=True))
    op.add_column("users", sa.Column("first_analytics_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "first_analytics_json")
    op.drop_column("users", "first_utm_json")
    op.drop_column("users", "first_referrer")
    op.drop_column("users", "first_landing_path")

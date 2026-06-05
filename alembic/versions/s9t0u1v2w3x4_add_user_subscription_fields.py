"""add user subscription fields

Revision ID: s9t0u1v2w3x4
Revises: r8s9t0u1v2w3
Create Date: 2026-06-06 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "s9t0u1v2w3x4"
down_revision: str | None = "r8s9t0u1v2w3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("telegram_id", existing_type=sa.BigInteger(), nullable=True)
        batch_op.add_column(sa.Column("subscription_status", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("tariff_plan", sa.String(length=32), nullable=False, server_default="none"))
        batch_op.add_column(sa.Column("tariff_accounts_limit", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("tariff_posts_per_day", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("tariff_projects_limit", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("tariff_queue_days", sa.Integer(), nullable=False, server_default="0"))

    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("subscription_status", server_default=None)
        batch_op.alter_column("tariff_plan", server_default=None)
        batch_op.alter_column("tariff_accounts_limit", server_default=None)
        batch_op.alter_column("tariff_posts_per_day", server_default=None)
        batch_op.alter_column("tariff_projects_limit", server_default=None)
        batch_op.alter_column("tariff_queue_days", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("tariff_queue_days")
        batch_op.drop_column("tariff_projects_limit")
        batch_op.drop_column("tariff_posts_per_day")
        batch_op.drop_column("tariff_accounts_limit")
        batch_op.drop_column("tariff_plan")
        batch_op.drop_column("subscription_status")
        batch_op.alter_column("telegram_id", existing_type=sa.BigInteger(), nullable=False)

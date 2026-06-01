"""add account proxy circuit breaker

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-06-01 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "q7r8s9t0u1v2"
down_revision: str | None = "p6q7r8s9t0u1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.add_column(sa.Column("assigned_port", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("proxy_error_count", sa.Integer(), nullable=False, server_default="0"))

    op.create_index("ix_accounts_assigned_port_unique", "accounts", ["assigned_port"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_accounts_assigned_port_unique", table_name="accounts")

    with op.batch_alter_table("accounts") as batch_op:
        batch_op.drop_column("proxy_error_count")
        batch_op.drop_column("assigned_port")

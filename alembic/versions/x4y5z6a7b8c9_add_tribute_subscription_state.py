"""add tribute subscription state

Revision ID: x4y5z6a7b8c9
Revises: w3x4y5z6a7b8
Create Date: 2026-08-31 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "x4y5z6a7b8c9"
down_revision: str | None = "w3x4y5z6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("subscription_phase", sa.String(length=32), nullable=False, server_default="none"))
    op.add_column("users", sa.Column("subscription_trial_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("subscription_paid_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("subscription_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("tribute_last_event_type", sa.String(length=128), nullable=True))
    op.add_column("users", sa.Column("tribute_last_event_json", sa.JSON(), nullable=True))
    op.alter_column("users", "subscription_phase", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "tribute_last_event_json")
    op.drop_column("users", "tribute_last_event_type")
    op.drop_column("users", "subscription_expires_at")
    op.drop_column("users", "subscription_paid_at")
    op.drop_column("users", "subscription_trial_started_at")
    op.drop_column("users", "subscription_phase")

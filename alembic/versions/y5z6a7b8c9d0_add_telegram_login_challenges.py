"""add telegram login challenges

Revision ID: y5z6a7b8c9d0
Revises: x4y5z6a7b8c9
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "y5z6a7b8c9d0"
down_revision: str | None = "x4y5z6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "telegram_login_challenges",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("browser_secret_hash", sa.String(length=64), nullable=False),
        sa.Column("bot_secret_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("telegram_id", sa.BigInteger(), nullable=True),
        sa.Column("telegram_profile_json", sa.JSON(), nullable=True),
        sa.Column("attribution_json", sa.JSON(), nullable=True),
        sa.Column("display_code", sa.String(length=16), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("result_token_encrypted", sa.Text(), nullable=True),
        sa.Column("result_retry_until", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_telegram_login_challenges_bot_secret_hash",
        "telegram_login_challenges",
        ["bot_secret_hash"],
        unique=True,
    )
    op.create_index(
        "ix_telegram_login_challenges_expires_at",
        "telegram_login_challenges",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_telegram_login_challenges_expires_at", table_name="telegram_login_challenges")
    op.drop_index("ix_telegram_login_challenges_bot_secret_hash", table_name="telegram_login_challenges")
    op.drop_table("telegram_login_challenges")

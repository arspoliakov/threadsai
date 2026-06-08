"""add account extension links

Revision ID: u1v2w3x4y5z6
Revises: t0u1v2w3x4y5
Create Date: 2026-06-09 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "u1v2w3x4y5z6"
down_revision: str | None = "t0u1v2w3x4y5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "account_extension_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_account_extension_links_id"), "account_extension_links", ["id"], unique=False)
    op.create_index(op.f("ix_account_extension_links_expires_at"), "account_extension_links", ["expires_at"], unique=False)
    op.create_index(op.f("ix_account_extension_links_owner_id"), "account_extension_links", ["owner_id"], unique=False)
    op.create_index(op.f("ix_account_extension_links_token_hash"), "account_extension_links", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_account_extension_links_token_hash"), table_name="account_extension_links")
    op.drop_index(op.f("ix_account_extension_links_owner_id"), table_name="account_extension_links")
    op.drop_index(op.f("ix_account_extension_links_expires_at"), table_name="account_extension_links")
    op.drop_index(op.f("ix_account_extension_links_id"), table_name="account_extension_links")
    op.drop_table("account_extension_links")

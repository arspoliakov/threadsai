"""add account owner

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-05-23 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op


revision: str = "i9j0k1l2m3n4"
down_revision: Union[str, None] = "h8i9j0k1l2m3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_accounts_owner_id_users", "users", ["owner_id"], ["id"])

    op.create_index(op.f("ix_accounts_owner_id"), "accounts", ["owner_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_accounts_owner_id"), table_name="accounts")
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.drop_constraint("fk_accounts_owner_id_users", type_="foreignkey")
        batch_op.drop_column("owner_id")

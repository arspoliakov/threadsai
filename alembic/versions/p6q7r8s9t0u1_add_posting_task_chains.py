"""add posting task chains

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-05-28 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "p6q7r8s9t0u1"
down_revision: str | None = "o5p6q7r8s9t0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("posting_tasks") as batch_op:
        batch_op.add_column(sa.Column("posts_chain", sa.JSON(), nullable=True))

    connection = op.get_bind()
    posting_tasks = sa.table(
        "posting_tasks",
        sa.column("content_text", sa.Text()),
        sa.column("posts_chain", sa.JSON()),
    )
    connection.execute(
        posting_tasks.update()
        .where(posting_tasks.c.posts_chain.is_(None))
        .values(posts_chain=sa.func.json_array(posting_tasks.c.content_text))
    )

    with op.batch_alter_table("posting_tasks") as batch_op:
        batch_op.alter_column("posts_chain", nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("posting_tasks") as batch_op:
        batch_op.drop_column("posts_chain")

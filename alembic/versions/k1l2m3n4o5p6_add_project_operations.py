"""add project operations

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-05-23 19:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "k1l2m3n4o5p6"
down_revision: str | None = "j0k1l2m3n4o5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_operations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("action_type", sa.Enum("scraping", "generation", name="projectoperationtype"), nullable=False),
        sa.Column("status", sa.Enum("running", "success", "failed", name="projectoperationstatus"), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_project_operations_id"), "project_operations", ["id"], unique=False)
    op.create_index("ix_project_operations_project_action", "project_operations", ["project_id", "action_type"], unique=False)
    op.create_index("ix_project_operations_status", "project_operations", ["status"], unique=False)
    op.create_index(op.f("ix_project_operations_owner_id"), "project_operations", ["owner_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_project_operations_owner_id"), table_name="project_operations")
    op.drop_index("ix_project_operations_status", table_name="project_operations")
    op.drop_index("ix_project_operations_project_action", table_name="project_operations")
    op.drop_index(op.f("ix_project_operations_id"), table_name="project_operations")
    op.drop_table("project_operations")

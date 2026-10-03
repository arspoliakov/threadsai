"""Persist three introductory drafts and their lifetime generation allowance."""
from alembic import op
import sqlalchemy as sa

revision = "a9b0c1d2e3f4"
down_revision = "a8b9c0d1e2f3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("auto_generate", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("users", sa.Column("studio_trial_used", sa.Integer(), nullable=False, server_default="0"))
    op.create_table("studio_drafts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("topic", sa.String(600), nullable=False),
        sa.Column("content_text", sa.Text(), nullable=False),
        sa.Column("imported_task_id", sa.Integer(), sa.ForeignKey("posting_tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_studio_drafts_owner_id", "studio_drafts", ["owner_id"])


def downgrade() -> None:
    op.drop_table("studio_drafts")
    op.drop_column("users", "studio_trial_used")
    op.drop_column("projects", "auto_generate")

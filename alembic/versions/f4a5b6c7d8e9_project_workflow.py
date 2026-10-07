"""Isolated project style, review mode, onboarding and persistent text revisions."""
from alembic import op
import sqlalchemy as sa

revision = "f4a5b6c7d8e9"
down_revision = "e3f4a5b6c7d8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("projects", sa.Column("publication_mode", sa.String(16), server_default="auto", nullable=False))
    op.add_column("projects", sa.Column("style_body", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("onboarding_state", sa.JSON(), nullable=True))
    connection = op.get_bind()
    connection.execute(sa.text("UPDATE projects SET publication_mode = CASE WHEN auto_generate THEN 'auto' ELSE 'manual' END"))
    # Preserve every active style, in the same order and headings as prompt_builder.
    # An empty snapshot also freezes the absence of a style for existing projects.
    styles = {}
    for row in connection.execute(sa.text("SELECT owner_id, title, body FROM global_prompts WHERE is_active = 1 AND prompt_type = 'virality' ORDER BY id")):
        styles.setdefault(row.owner_id, []).append(f"### {row.title}\nType: virality\n{row.body}")
    for row in connection.execute(sa.text("SELECT id, owner_id FROM projects")):
        connection.execute(sa.text("UPDATE projects SET style_body = :body WHERE id = :id"), {"body": "\n\n".join(styles.get(row.owner_id, [])), "id": row.id})
    op.create_table("posting_task_revisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("posting_tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("posts_chain", sa.JSON(), nullable=False),
        sa.Column("reason", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index("ix_posting_task_revisions_task_id", "posting_task_revisions", ["task_id"])
    op.create_index("ix_posting_task_revisions_owner_id", "posting_task_revisions", ["owner_id"])


def downgrade():
    op.drop_table("posting_task_revisions")
    op.drop_column("users", "onboarding_state")
    op.drop_column("projects", "style_body")
    op.drop_column("projects", "publication_mode")

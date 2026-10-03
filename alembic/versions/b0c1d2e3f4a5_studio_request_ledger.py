"""Durable studio request replay and expiring quota reservations."""
from alembic import op
import sqlalchemy as sa

revision = "b0c1d2e3f4a5"
down_revision = "a9b0c1d2e3f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("studio_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("request_key", sa.String(128), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("reserved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
    )
    op.create_index("ix_studio_requests_owner_id", "studio_requests", ["owner_id"])
    op.create_index("ix_studio_requests_owner_kind_key", "studio_requests", ["owner_id", "kind", "request_key"], unique=True)


def downgrade() -> None:
    op.drop_table("studio_requests")

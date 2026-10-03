"""Opt-in Proxly assignments; legacy connections remain unchanged."""
from alembic import op
import sqlalchemy as sa

revision = "c1d2e3f4a5b6"
down_revision = "b0c1d2e3f4a5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("accounts", sa.Column("proxy_provider", sa.String(32), nullable=False, server_default="proxymarket"))
    op.add_column("accounts", sa.Column("proxy_session_id", sa.Integer(), nullable=True))
    op.add_column("accounts", sa.Column("proxy_credentials_encrypted", sa.Text(), nullable=True))
    op.create_index("ix_accounts_proxy_session_id_unique", "accounts", ["proxy_session_id"], unique=True)
    op.create_table("proxy_provider_configs",
        sa.Column("provider", sa.String(32), primary_key=True),
        sa.Column("credentials_encrypted", sa.Text(), nullable=False),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("country", sa.String(2), nullable=False),
        sa.Column("sticky_minutes", sa.Integer(), nullable=False),
        sa.Column("package_gb", sa.Float(), nullable=False),
        sa.Column("package_cost_rub", sa.Float(), nullable=False),
        sa.Column("next_session_id", sa.Integer(), nullable=False, server_default="11"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table("proxy_usage_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("service", sa.String(32), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("operation", sa.String(32), nullable=False),
        sa.Column("estimated_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("source", sa.String(48), nullable=False),
        sa.Column("status", sa.String(48), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_proxy_usage_events_account_id", "proxy_usage_events", ["account_id"])
    op.create_index("ix_proxy_usage_events_owner_id", "proxy_usage_events", ["owner_id"])


def downgrade():
    op.drop_table("proxy_usage_events")
    op.drop_table("proxy_provider_configs")
    op.drop_index("ix_accounts_proxy_session_id_unique", table_name="accounts")
    with op.batch_alter_table("accounts") as batch:
        batch.drop_column("proxy_credentials_encrypted")
        batch.drop_column("proxy_session_id")
        batch.drop_column("proxy_provider")

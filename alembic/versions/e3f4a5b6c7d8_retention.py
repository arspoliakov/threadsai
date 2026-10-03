"""Consent-based durable Telegram retention campaigns, disabled by default."""
from alembic import op
import sqlalchemy as sa

revision = "e3f4a5b6c7d8"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def timestamps():
    return [sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)]


def upgrade():
    op.add_column("users", sa.Column("marketing_consent", sa.Boolean(), server_default="0", nullable=False))
    op.add_column("users", sa.Column("onboarding_consent", sa.Boolean(), server_default="0", nullable=False))
    op.add_column("users", sa.Column("retention_consent_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table("retention_bot_contacts", sa.Column("telegram_id", sa.BigInteger(), primary_key=True),
                    sa.Column("reachable", sa.Boolean(), nullable=False), sa.Column("blocked", sa.Boolean(), nullable=False), *timestamps())
    op.create_table("retention_settings", sa.Column("id", sa.Integer(), primary_key=True),
                    sa.Column("sending_enabled", sa.Boolean(), nullable=False), sa.Column("automated_enabled", sa.Boolean(), nullable=False))
    op.execute("INSERT INTO retention_settings (id, sending_enabled, automated_enabled) VALUES (1, 0, 0)")
    op.create_table("retention_consent_events", sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("marketing_consent", sa.Boolean(), nullable=False), sa.Column("onboarding_consent", sa.Boolean(), nullable=False),
        sa.Column("version", sa.String(32), nullable=False), sa.Column("source", sa.String(32), nullable=False), *timestamps())
    op.create_index("ix_retention_consent_events_user_id", "retention_consent_events", ["user_id"])
    op.create_table("retention_campaigns", sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(150), nullable=False), sa.Column("message", sa.Text(), nullable=False),
        sa.Column("segment", sa.String(32), nullable=False), sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False), sa.Column("recipient_count", sa.Integer(), nullable=False),
        sa.Column("request_key", sa.String(64), unique=True, nullable=False), *timestamps())
    op.create_table("retention_deliveries", sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("campaign_id", sa.Integer(), sa.ForeignKey("retention_campaigns.id"), nullable=True),
        sa.Column("dedupe_key", sa.String(100), unique=True, nullable=False), sa.Column("rule_key", sa.String(32)),
        sa.Column("kind", sa.String(32), nullable=False), sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False), sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True)), sa.Column("attempted_at", sa.DateTime(timezone=True)),
        sa.Column("telegram_message_id", sa.Integer()), sa.Column("error_code", sa.String(50)), *timestamps())
    for column in ("user_id", "campaign_id", "status"):
        op.create_index(f"ix_retention_deliveries_{column}", "retention_deliveries", [column])


def downgrade():
    for table in ("retention_deliveries", "retention_campaigns", "retention_consent_events", "retention_settings", "retention_bot_contacts"):
        op.drop_table(table)
    for column in ("retention_consent_updated_at", "onboarding_consent", "marketing_consent"):
        op.drop_column("users", column)

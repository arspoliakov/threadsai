"""Store explicit registration agreements; do not invent consent for existing users."""
from alembic import op
import sqlalchemy as sa

revision = "a8b9c0d1e2f3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("registration_consents_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "registration_consents_json")

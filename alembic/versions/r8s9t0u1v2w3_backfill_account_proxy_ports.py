"""backfill account proxy ports

Revision ID: r8s9t0u1v2w3
Revises: q7r8s9t0u1v2
Create Date: 2026-06-01 12:30:00.000000
"""

from collections.abc import Sequence
import os

import sqlalchemy as sa
from alembic import op


revision: str = "r8s9t0u1v2w3"
down_revision: str | None = "q7r8s9t0u1v2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    port_start = int(os.getenv("PROXY_PORT_START", "10000"))
    port_end = int(os.getenv("PROXY_PORT_END", "10999"))
    existing_ports = {
        row[0]
        for row in bind.execute(
            sa.text("SELECT assigned_port FROM accounts WHERE assigned_port IS NOT NULL")
        ).fetchall()
    }
    next_port = port_start

    accounts = bind.execute(
        sa.text(
            "SELECT id FROM accounts "
            "WHERE platform = 'threads' AND assigned_port IS NULL "
            "ORDER BY id ASC"
        )
    ).fetchall()

    for (account_id,) in accounts:
        while next_port in existing_ports:
            next_port += 1

        if next_port > port_end:
            break

        bind.execute(
            sa.text("UPDATE accounts SET assigned_port = :port WHERE id = :account_id"),
            {"port": next_port, "account_id": account_id},
        )
        existing_ports.add(next_port)
        next_port += 1


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE accounts SET assigned_port = NULL"))

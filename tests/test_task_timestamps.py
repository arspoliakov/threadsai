import unittest
from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy import Column, DateTime, MetaData, Table, create_engine, select

from app.api.routes.tasks import PostingTaskRead


class TaskTimestampTest(unittest.TestCase):
    def test_sqlite_utc_and_aware_task_times_have_explicit_utc_json(self):
        engine = create_engine("sqlite:///:memory:")
        table = Table("timestamp_probe", MetaData(), Column("at", DateTime(timezone=True)))
        table.metadata.create_all(engine)
        try:
            with engine.begin() as db:
                db.execute(table.insert().values(at=datetime(2026, 10, 3, 9, tzinfo=UTC)))
                stored = db.scalar(select(table.c.at))
            self.assertIsNone(stored.tzinfo)
            task = PostingTaskRead.model_validate({
                "id": 1, "project_id": 1, "account_id": None, "source_trend_id": None,
                "platform": "threads", "content_text": "Тестовый пост", "posts_chain": ["Тестовый пост"],
                "media_url": None, "status": "queued", "scheduled_at": stored,
                "started_at": datetime(2026, 10, 3, 12, tzinfo=timezone(timedelta(hours=3))),
                "finished_at": None, "retry_count": 0, "error_message": None,
                "external_post_url": None, "generation_metadata": None,
                "created_at": stored, "updated_at": stored,
            })
            data = task.model_dump(mode="json")
            for field in ("scheduled_at", "started_at", "created_at", "updated_at"):
                self.assertEqual(data[field], "2026-10-03T09:00:00Z")
            self.assertIsNone(data["finished_at"])
            self.assertEqual(task.scheduled_at.tzinfo, UTC)
        finally:
            engine.dispose()

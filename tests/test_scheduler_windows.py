from __future__ import annotations

import unittest
from datetime import UTC, datetime

from pydantic import ValidationError

from app.db.models import Project
from app.posting.scheduler import _is_project_in_active_window, _project_active_window_bounds
from app.schemas.project import ProjectCreate


class SchedulerWindowTest(unittest.TestCase):
    def test_overnight_window_includes_time_after_midnight(self) -> None:
        project = Project(
            name="Night project",
            slug="night-project",
            active_hours_start="21:00",
            active_hours_end="02:00",
            timezone="UTC",
        )
        reference = datetime(2026, 7, 12, 1, 0, tzinfo=UTC)

        start_at, end_at = _project_active_window_bounds(project, reference)

        self.assertEqual(start_at, datetime(2026, 7, 11, 21, 0, tzinfo=UTC))
        self.assertEqual(end_at, datetime(2026, 7, 12, 2, 0, tzinfo=UTC))
        self.assertTrue(_is_project_in_active_window(project, reference))

    def test_invalid_clock_value_is_rejected_by_api_schema(self) -> None:
        with self.assertRaises(ValidationError):
            ProjectCreate(name="Bad clock", active_hours_start="29:70")


if __name__ == "__main__":
    unittest.main()

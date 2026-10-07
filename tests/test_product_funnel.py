from datetime import UTC, datetime, timedelta
import unittest

from app.db.models import Platform, PostingTask, PostingTaskStatus, Project, StudioDraft, TributeWebhookEvent, User
from app.services.product_funnel import build_product_funnel, confirmed_payment_at
from tests import test_admin_access as admin_fixture


class ProductFunnelTest(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = admin_fixture.AdminAccessTest.asyncSetUp
    asyncTearDown = admin_fixture.AdminAccessTest.asyncTearDown
    header = admin_fixture.AdminAccessTest.header

    def test_payment_requires_applied_regular_subscription(self):
        now = datetime.now(UTC)
        for name, kind, status, accepted in [
            ("new_subscription", "regular", "applied", True),
            ("renewed_subscription", "regular", "applied", True),
            ("new_subscription", "trial", "applied", False),
            ("new_subscription", "gift", "applied", False),
            ("cancelled_subscription", "regular", "applied", False),
            ("new_subscription", "regular", "pending", False),
        ]:
            event = TributeWebhookEvent(created_at=now, status=status, payload={
                "name": name, "created_at": now.isoformat(), "payload": {"type": kind}})
            self.assertEqual(confirmed_payment_at(event) is not None, accepted)

    async def test_cohort_milestones_are_cumulative_and_ignore_uncertain_publication(self):
        now = datetime(2026, 10, 7, 15, tzinfo=UTC)
        async with self.sessions() as db:
            (await db.get(User, 1)).created_at = now - timedelta(days=2)
            (await db.get(User, 2)).created_at = now - timedelta(days=20)
            db.add_all([
                Project(id=1, owner_id=1, name="Project", slug="project", global_context="About product", created_at=now - timedelta(days=1)),
                StudioDraft(owner_id=1, topic="Topic", content_text="Text", created_at=now - timedelta(days=1)),
                TributeWebhookEvent(event_key="one", telegram_id=111, status="applied", created_at=now - timedelta(days=1), payload={
                    "name": "renewed_subscription", "created_at": (now - timedelta(days=1)).isoformat(), "payload": {"type": "regular"}}),
                TributeWebhookEvent(event_key="two", telegram_id=222, status="applied", created_at=now - timedelta(days=1), payload={
                    "name": "new_subscription", "created_at": (now - timedelta(days=1)).isoformat(), "payload": {"type": "trial"}}),
            ])
            for ident, at, metadata in [(1, now - timedelta(days=1), {}), (2, now, {}), (3, now - timedelta(days=2), {"publication_confirmation_pending": True})]:
                db.add(PostingTask(id=ident, project_id=1, platform=Platform.THREADS, content_text="Text", posts_chain=["Text"],
                    status=PostingTaskStatus.SUCCESS, finished_at=at, generation_metadata=metadata))
            await db.commit()
            result = await build_product_funnel(db, days=7, now=now)
            stages = {s["key"]: s["users"] for s in result["stages"]}
            self.assertEqual(result["cohort"]["users"], 1)
            self.assertEqual(stages["confirmed_paid"], 1)
            self.assertEqual(stages["first_publication"], 1)
            self.assertEqual(stages["repeated_publication"], 1)
            self.assertEqual(stages["account_connected"], 0)
            self.assertEqual(result["timings"]["registration_to_publication_median_hours"], 24)
            self.assertEqual(result["timings"]["registration_to_trial_median_hours"], 24)
            self.assertEqual(result["paid_without_publication"], 0)
            all_users = await build_product_funnel(db, days=0, now=now)
            self.assertEqual(all_users["cohort"]["users"], 2)

    async def test_admin_only_endpoint_and_known_cohort_filters(self):
        result = await self.client.get("/admin/product-funnel?days=7", headers=self.header(1, 111))
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIn("stages", result.json())
        self.assertEqual((await self.client.get("/admin/product-funnel", headers=self.header(2, 222))).status_code, 403)
        self.assertEqual((await self.client.get("/admin/product-funnel")).status_code, 401)
        self.assertEqual((await self.client.get("/admin/product-funnel?days=12", headers=self.header(1, 111))).status_code, 422)

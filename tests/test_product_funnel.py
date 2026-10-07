from datetime import UTC, datetime, timedelta
import unittest
from unittest.mock import patch

from app.db.models import Platform, PostingTask, PostingTaskStatus, Project, StudioDraft, TributeWebhookEvent, User
from app.services.product_funnel import build_product_funnel, confirmed_payment_at
from app.services.product_analytics import attribution_source, build_product_analytics
from app.core.config import settings
from tests import test_admin_access as admin_fixture


class ProductFunnelTest(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = admin_fixture.AdminAccessTest.asyncSetUp
    asyncTearDown = admin_fixture.AdminAccessTest.asyncTearDown
    header = admin_fixture.AdminAccessTest.header

    def test_payment_requires_applied_regular_subscription(self):
        self.assertEqual(attribution_source(User(first_name="Fixture", first_utm_json={"utm_source": "телеграм"})),
                         ("utm:телеграм", "телеграм"))
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
            (await db.get(User, 1)).telegram_id = 333
            (await db.get(User, 2)).created_at = now - timedelta(days=20)
            db.add_all([
                Project(id=1, owner_id=1, name="Project", slug="project", global_context="About product", created_at=now - timedelta(days=1)),
                StudioDraft(owner_id=1, topic="Topic", content_text="Text", created_at=now - timedelta(days=1)),
                TributeWebhookEvent(event_key="one", telegram_id=333, status="applied", created_at=now - timedelta(days=1), payload={
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
        for path, field in [("/admin/product-funnel", "stages"), ("/admin/product-analytics", "sources")]:
            result = await self.client.get(path + "?days=7", headers=self.header(1, 111))
            self.assertEqual(result.status_code, 200, result.text)
            self.assertIn(field, result.json())
            self.assertEqual((await self.client.get(path, headers=self.header(2, 222))).status_code, 403)
            self.assertEqual((await self.client.get(path)).status_code, 401)
            self.assertEqual((await self.client.get(path + "?days=12", headers=self.header(1, 111))).status_code, 422)

    async def test_observed_analytics_excludes_operator_tests_and_immature_retention(self):
        now = datetime(2026, 10, 7, 15, tzinfo=UTC)
        async with self.sessions() as db:
            (await db.get(User, 1)).created_at = now - timedelta(days=40)
            customer = await db.get(User, 2)
            customer.created_at = now - timedelta(days=40)
            customer.first_utm_json = {"utm_source": "yandex", "utm_content": "private-details"}
            db.add_all([
                User(id=3, telegram_id=333, first_name="Mature", created_at=now - timedelta(days=8, hours=12),
                     first_referrer="https://google.com/search?q=private-client-data"),
                User(id=4, telegram_id=444, first_name="Recent", created_at=now - timedelta(days=7, hours=2)),
                User(id=5, telegram_id=555, first_name="Fixture", created_at=now - timedelta(days=40)),
            ])
            for ident in (1, 2, 3, 4, 5):
                db.add(Project(id=ident, owner_id=ident, name="Project", slug=f"project-{ident}"))
            for key, tg_id, name, kind, at in [
                ("first", 222, "new_subscription", "regular", customer.created_at + timedelta(days=1)),
                ("second", 222, "renewed_subscription", "regular", customer.created_at + timedelta(days=31)),
                ("after-trial", 333, "renewed_subscription", "regular", now - timedelta(days=3)),
                ("trial", 444, "new_subscription", "trial", now - timedelta(days=2)),
                ("owner", 111, "new_subscription", "regular", now - timedelta(days=2)),
                ("test", 555, "new_subscription", "regular", now - timedelta(days=2)),
            ]:
                db.add(TributeWebhookEvent(event_key=key, telegram_id=tg_id, status="applied", created_at=at,
                    payload={"name": name, "created_at": at.isoformat(),
                             "payload": {"type": kind, "amount": 12345, "currency": "rub"}}))
            for pid, at in [(2, customer.created_at + timedelta(days=7, hours=1)),
                            (2, customer.created_at + timedelta(days=30, hours=1)),
                            (3, now - timedelta(days=1, hours=11))]:
                db.add(PostingTask(project_id=pid, platform=Platform.THREADS, content_text="Text", posts_chain=["Text"],
                    status=PostingTaskStatus.SUCCESS, finished_at=at))
            await db.commit()
            with patch.object(settings, "analytics_excluded_user_ids", [5]):
                result = await build_product_analytics(db, days=0, now=now)
                funnel = await build_product_funnel(db, days=0, now=now)
            self.assertEqual(result["cohort"]["users"], 3)
            self.assertEqual(result["cohort"]["excluded_users"], 2)
            self.assertEqual(funnel["cohort"]["users"], 3)
            self.assertEqual(result["payments"]["confirmed_events"], 3)
            self.assertEqual(result["payments"]["paying_users"], 2)
            self.assertEqual(result["payments"]["repeat_paid_users"], 1)
            self.assertEqual(result["payments"]["users_with_renewal_event"], 2)
            self.assertIsNone(result["payments"]["revenue"])
            self.assertEqual(result["payments"]["revenue_status"], "amount_units_unconfirmed")
            self.assertEqual(result["retention"][0]["eligible_users"], 2)
            self.assertEqual(result["retention"][0]["retained_users"], 2)
            self.assertEqual(result["retention"][1]["eligible_users"], 1)
            self.assertEqual(result["retention"][1]["retained_users"], 1)
            self.assertNotIn("private-client-data", str(result))
            self.assertNotIn("private-details", str(result))
            self.assertEqual(result["coverage"]["unknown_source_users"], 1)

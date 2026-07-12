from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.models import Platform, Project, SavedTrend
from app.parsers.scraper import save_scraped_posts
from app.parsers.trend_analyzer import analyze_and_save_trends
from app.schemas.trend import TrendAIAnalysis


class TrendRefreshTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            poolclass=StaticPool,
        )
        self.session_factory = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        async with self.session_factory() as session:
            session.add(Project(id=1, name="Trends", slug="trends"))
            session.add(
                SavedTrend(
                    project_id=1,
                    platform=Platform.THREADS,
                    source_url="https://threads.net/old",
                    raw_text="Старая рабочая идея, которую нельзя терять при пустой ленте.",
                    virality_score=100,
                    analyzed=True,
                )
            )
            await session.commit()

    async def asyncTearDown(self) -> None:
        await self.engine.dispose()

    async def test_empty_raw_refresh_keeps_previous_trends(self) -> None:
        async with self.session_factory() as session:
            saved = await save_scraped_posts(project_id=1, raw_posts=[], session=session)
            count = await session.scalar(
                select(func.count(SavedTrend.id)).where(SavedTrend.project_id == 1)
            )

        self.assertEqual(saved, 0)
        self.assertEqual(count, 1)

    async def test_previous_trends_are_replaced_only_after_successful_analysis(self) -> None:
        analysis = TrendAIAnalysis(
            hook_mechanic="конкретное наблюдение",
            structure_pattern="сцена -> вывод -> вопрос",
            tone_and_rhythm="спокойный разговорный",
            living_phrases=["вот что заметил"],
            semantic_forbidden_zone=["чужая тема"],
            virality_score=8,
        )
        raw_post = {
            "text": "Новая свежая идея с достаточной длиной и живым наблюдением.",
            "views": 1000,
            "likes": 120,
            "comments": 20,
            "author": "new_author",
            "url": "https://threads.net/new",
            "platform": Platform.THREADS,
        }

        with patch(
            "app.parsers.trend_analyzer._reverse_engineer_post",
            new=AsyncMock(return_value=analysis),
        ):
            async with self.session_factory() as session:
                saved = await analyze_and_save_trends(
                    project_id=1,
                    raw_posts=[raw_post],
                    session=session,
                )
                rows = list(
                    (
                        await session.scalars(
                            select(SavedTrend).where(SavedTrend.project_id == 1)
                        )
                    ).all()
                )

        self.assertEqual(len(saved), 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].raw_text, raw_post["text"])
        self.assertTrue(rows[0].analyzed)


if __name__ == "__main__":
    unittest.main()

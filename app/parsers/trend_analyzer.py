from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_engine.client import DEEPINFRA_MODEL, get_deepinfra_client
from app.db.models import Platform, SavedTrend
from app.schemas.trend import TrendAIAnalysis


STOP_WORDS = ["\u0441\u0442\u0430\u0432\u043a\u0438", "\u043a\u0430\u0437\u0438\u043d\u043e", "\u043f\u043e\u043b\u0438\u0442\u0438\u043a\u0430", "\u0441\u043a\u0430\u043c"]
MAX_POSTS_PER_ANALYSIS = 5
MAX_TEXT_LENGTH = 1000

TREND_REVERSE_ENGINEERING_PROMPT = """
Ты - аналитик живой речи и вирусных механик.
Разбери пост так, чтобы потом генератор мог взять из него не тему, а ДНК формата.

Что нужно извлечь:
1. hook_mechanic - как именно захвачено внимание.
2. structure_pattern - структура движения мысли: старт -> мостик -> поворот -> финал.
3. tone_and_rhythm - как звучит текст: бытовой, рубленый, спокойный, ироничный, короткие/длинные фразы.
4. living_phrases - 3-7 коротких живых оборотов или микрофраз, которые можно адаптировать под другую тему.
   Это не должны быть уникальные факты, имена, названия, даты или чужой сюжет.
   Нужны только речевые паттерны: "мы тут с ребятами", "в итоге просто", "если хотите - пишите".
5. semantic_forbidden_zone - 3-7 пунктов, что категорически нельзя переносить из этого тренда в новый пост:
   тема, сюжет, конкретный конфликт, персонажи, факты, события, ниши.
6. virality_score - оценка от 1 до 10.

Верни строго JSON без markdown:
{
  "hook_mechanic": "...",
  "structure_pattern": "...",
  "tone_and_rhythm": "...",
  "living_phrases": ["...", "..."],
  "semantic_forbidden_zone": ["...", "..."],
  "virality_score": 8
}
"""


class RawFeedPost(BaseModel):
    text: str = Field(min_length=1)
    views: int = Field(ge=0)
    likes: int = Field(ge=0)
    comments: int = Field(default=0, ge=0)
    author: str | None = None
    url: str
    platform: Platform

    @property
    def engagement_rate(self) -> float:
        if self.views <= 0:
            return 0.0

        return (self.likes + self.comments) / self.views


async def analyze_and_save_trends(
    project_id: int,
    raw_posts: list[RawFeedPost | dict[str, Any]],
    session: AsyncSession,
) -> list[SavedTrend]:
    posts = [_coerce_raw_post(post) for post in raw_posts]
    selected_posts = select_top_posts_by_er(posts)
    saved_trends: list[SavedTrend] = []

    for post in selected_posts:
        truncated_text = post.text[:MAX_TEXT_LENGTH]
        analysis = await _reverse_engineer_post(truncated_text)
        trend = await _get_existing_trend(
            project_id=project_id,
            raw_text=truncated_text,
            session=session,
        )

        if trend is None:
            trend = SavedTrend(
                project_id=project_id,
                platform=post.platform,
                source_url=post.url,
                author_handle=post.author,
                raw_text=truncated_text,
            )
            session.add(trend)

        trend.platform = post.platform
        trend.source_url = post.url
        trend.author_handle = post.author
        trend.metrics_json = {
            "views": post.views,
            "likes": post.likes,
            "comments": post.comments,
            "engagement_rate": post.engagement_rate,
        }
        trend.ai_summary = json.dumps(analysis.model_dump(), ensure_ascii=False)
        trend.virality_score = float(post.likes)
        trend.hook_analysis = analysis.hook_mechanic
        trend.hook_mechanic = analysis.hook_mechanic
        trend.structure_pattern = analysis.structure_pattern
        trend.tone_and_rhythm = analysis.tone_and_rhythm
        trend.living_phrases = _normalize_string_list(analysis.living_phrases)
        trend.semantic_forbidden_zone = _normalize_string_list(analysis.semantic_forbidden_zone)
        trend.adaptation_notes = None
        trend.parsed_at = datetime.now(UTC)
        trend.analyzed = True
        session.add(trend)
        saved_trends.append(trend)

    await session.commit()

    for trend in saved_trends:
        await session.refresh(trend)

    return saved_trends


def select_top_posts_by_er(posts: list[RawFeedPost]) -> list[RawFeedPost]:
    clean_posts = [post for post in posts if not contains_stop_word(post.text)]
    return sorted(clean_posts, key=_trend_sort_score, reverse=True)[:MAX_POSTS_PER_ANALYSIS]


def _trend_sort_score(post: RawFeedPost) -> float:
    if post.views > 0:
        return post.engagement_rate

    return float(post.likes)


def contains_stop_word(text: str) -> bool:
    normalized_text = text.casefold()
    return any(stop_word.casefold() in normalized_text for stop_word in STOP_WORDS)


async def _get_existing_trend(
    project_id: int,
    raw_text: str,
    session: AsyncSession,
) -> SavedTrend | None:
    stmt = (
        select(SavedTrend)
        .where(
            SavedTrend.project_id == project_id,
            SavedTrend.raw_text == raw_text,
        )
        .limit(1)
    )
    return await session.scalar(stmt)


async def _reverse_engineer_post(post_text: str) -> TrendAIAnalysis:
    client = get_deepinfra_client()
    response = await client.chat.completions.create(
        model=DEEPINFRA_MODEL,
        messages=[
            {"role": "system", "content": TREND_REVERSE_ENGINEERING_PROMPT},
            {"role": "user", "content": post_text},
        ],
        response_format={"type": "json_object"},
    )

    content = response.choices[0].message.content or "{}"
    return _parse_ai_analysis(content)


def _parse_ai_analysis(content: str) -> TrendAIAnalysis:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        payload = _extract_json_object(content)

    return TrendAIAnalysis.model_validate(payload)


def _extract_json_object(content: str) -> dict[str, Any]:
    start = content.find("{")
    end = content.rfind("}")

    if start == -1 or end == -1 or end <= start:
        raise ValueError("AI trend analysis response does not contain a valid JSON object.")

    return json.loads(content[start : end + 1])


def _coerce_raw_post(post: RawFeedPost | dict[str, Any]) -> RawFeedPost:
    if isinstance(post, RawFeedPost):
        return post

    return RawFeedPost.model_validate(post)


def _normalize_string_list(items: list[str]) -> list[str]:
    return list(dict.fromkeys(item.strip() for item in items if item.strip()))

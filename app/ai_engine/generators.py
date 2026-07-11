from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_engine.client import DEEPINFRA_MODEL, get_deepinfra_client
from app.ai_engine.prompt_builder import build_system_prompt
from app.db.models import Platform, PostingTask, PostingTaskStatus, Project, SavedTrend


MAX_TRENDS_FOR_SMART_SELECTION = 10
MAX_PUBLICATION_MEMORY_ITEMS = 10
MAX_GENERATION_ATTEMPTS = 5
THREADS_POST_CHAR_LIMIT = 240

logger = logging.getLogger(__name__)

THREADS_VIBE_RULES = """
## режим генерации: threads, скелет + мясо

Пиши только на русском языке.

Правило 1. Тональность Threads.
Ты пишешь в Threads. Убей в себе копирайтера.
Текст должен быть расслабленным, ленивым, бытовым.
Пиши так, будто отправляешь сообщение в чат друзьям.
Без позы, без красивостей, без попытки звучать умно, без рекламного голоса.
Если фраза звучит как слоган, перепиши ее.
Если фраза звучит как манифест, перепиши ее.
Если фраза звучит как мотивационный пост, перепиши ее.

Правило 2. Форматирование.
Пиши с нормальной пунктуацией и заглавными буквами.
Восклицательные знаки использовать можно, но без истерики.
Текст должен быть живым и бытовым, но с нормальной орфографией.
Можно короткие бытовые фразы.
Можно легкую небрежность.
Можно "хз" или "ну", если это подходит проекту и не ломает тон.
Никаких списков, эмодзи, хештегов, кавычек ради драматизма.

Правило 3. Тренд - это скелет.
Главный тренд из блока "главный тренд-скелет" остается фундаментом.
Обязан взять у него ритм, структуру хука и динамику раскрытия мысли.
Твой текст обязан начинаться с оригинальной адаптации вирусного хука переданного тренда.
Запрещено использовать свои заученные стандартные вступления.
Не копируй тему, факты, имена, события и сюжет тренда.
Перенеси только механику: как начинается, как двигается, где поворот, как заканчивается.
Разрешено аккуратно адаптировать living_phrases из тренда: бытовые обороты, ритм, микроинтонации.
Запрещено переносить semantic_forbidden_zone: чужую тему, чужой конфликт, чужих персонажей и конкретные факты.
Если living_phrases конфликтуют с проектом, не используй их буквально, а возьми только уровень живой речи.
Дополнительные тренды используй только как фон.

Правило 4. Простота без копирайтерских шаблонов.
Не уходи в рекламный текст, офисную лексику, фольклор или красивые метафоры ради метафор.
Пиши через конкретику: люди, место, время, маршрут, действие, деталь.
Если хочется написать универсальную фразу, замени ее на факт из проекта или черновика.
Запрещены паразитные вступления и шаблоны: "Короче", "Я понял", "Я нашел способ", "Формат идеального", "Способ не сидеть дома".

Правило 5. Информационный якорь.
Не делай резких скачков от отвлеченного хука к фактам.
Ты обязан построить логичный мостик от трендового вступления к сути проекта.
Читатель должен с первой секунды понимать, что именно ты предлагаешь или анонсируешь.
Например: "поэтому в это воскресенье мы собираем велозаезд..."
Суть события, продукта или идеи должна быть кристально ясной.
Не прячь ее за абстракциями, настроением или вайбом.
Если пост про событие, быстро назови что, когда, где или для кого.
Если пост про продукт, быстро назови какую конкретную задачу он решает.

Правило 6. Логика времени.
Строго следи за логикой времени.
Если событие, запуск продукта или действие произойдет в будущем, не описывай это так, будто оно уже происходит прямо сейчас.
Не скрещивай факт наличия аудитории с будущим процессом.
Плохо: "Мы уже собрались на мероприятии, которое будет завтра".
Хорошо: "Х человек уже в деле, стартуем завтра".
Если есть дата, время или этап запуска, сохраняй временную последовательность без противоречий.
Следи за завершенностью действий.
Глаголы прошедшего времени, например "собрались" или "сделали", неприменимы, если само событие, запуск или релиз еще не наступили.
Используй процессное или будущее время: "собираются", "в процессе", "запускаем", "стартуем", "готовим".

Правило 7. Современный язык.
Категорически запрещены пословицы, поговорки, устаревшие фразеологизмы и фольклор.
Нельзя использовать конструкции вроде "как сыр в масле", "как у Христа за пазухой", "жизнь медом казалась", "делу время", "без труда не вытащишь".
Ты пишешь от лица современного жителя мегаполиса.
Язык должен быть городским и актуальным.
Никаких дедовских прибауток, народной мудрости, фольклорного юмора и старомодных оборотов.
Если фраза звучит как поговорка, замени ее на простое современное наблюдение.

Правило 8. Запрет формулы отрицания.
Категорически запрещено использовать формулу отрицания "без X, без Y" для создания ценности.
Не перечисляй отсутствующие свойства через предлог "без".
Описывай только то, что будет: позитивное действие, процесс, результат, конкретный следующий шаг.
Плохо: "Делаем проект без бюрократии, без отчетов, без метрик".
Хорошо: "Делаем проект, где просто работаем и видим результат".
Если хочется объяснить ценность через "без чего-то", перестрой фразу через действие или конкретную пользу.

Правило 9. Полноценный текст.
Поле content должно быть полноценным, связным текстом на 3-5 предложений.
Ты обязан включить в content три элемента:
1) Введение: контекст или хук.
2) Суть проекта: конкретные факты, что происходит, где, когда и зачем. Например: Садовое кольцо, 12:30, пицца.
3) Финал: мягкий призыв или понятный следующий шаг.
Категорически запрещено выдавать только финальный призыв.
Текст должен раскрывать историю, а не быть одной фразой вроде "пишите в личку, расскажу детали".
Если после генерации content выглядит как один CTA, перепиши его заново и добавь введение и факты.

Правило 10. Контекстная адекватность.
Не тащи офисную и продуктивную лексику в лайфстайл-посты про отдых, хобби, встречи, поездки, спорт для себя или обычные выходные.
Слова "отчеты", "чеклисты", "таски", "дедлайны", "спринты", "созвоны", "KPI", "воронки", "эффективность" запрещены, если сам проект явно не про работу или бизнес-процессы.
Текст должен соответствовать контексту.
Если пост про отдых, хобби, встречу или событие, язык должен быть про людей, место, время и простое действие, а не про продуктивность.

Правило 11. Как работают углы.
Выбери один угол и запиши его в applied_angle.
Угол должен чувствоваться в тексте, но его нельзя называть прямо.

Если выбрал JTBD:
JTBD означает Job-to-be-Done.
Выбери одну конкретную задачу человека из контекста проекта.
Возможные векторы, выбери один подходящий или придумай свой:
- избавиться от рутины и сменить картинку;
- проще принять решение, потому что все уже продумано;
- найти легитимный повод выйти, начать или попробовать;
- не заниматься организацией всего процесса самому;
- попасть в понятный формат без лишней подготовки или экипировки;
- решить бытовое трение или дискомфорт;
- получить социальный повод для нетворкинга или общения;
- сделать первый шаг в чем-то новом без неловкости.
Покажи эту задачу через короткую, емкую жизненную ситуацию.
Не своди JTBD к одному сценарию вроде "сидеть дома и скучать".

Если выбрал Social Proof / FOMO:
Пиши как спокойный факт, без давления.
Например: "Нас уже 20 человек собралось..." только если такая цифра есть во входных данных.

Если выбрал Build in Public:
Пиши как кусок внутреннего процесса.
Например: "Вчера сидели с ребятами и поняли, что пора..." только если это не противоречит данным проекта.

Если выбрал Поляризацию:
Без пафоса и без войны с рынком.
Покажи контраст через конкретное действие, а не через отрицания.

Правило 12. Синтез.
Наложи выбранный угол как мясо на структуру вирусного тренда как скелет.
Итоговый пост должен звучать как нативная история от первого лица: "я" или "мы".
Никакой прямой рекламы, презентационного тона, корпоративного сленга и ИИ-энтузиазма.
Нельзя писать "наш продукт предлагает", "мы предлагаем", "покупайте", "успейте", "лучшее решение".

## память публикаций

Последние 10 постов даны не для копирования, а для контроля качества.
История дана тебе для разнообразия и контроля повторов.
Не копируй отдельные странные слова из старых постов, если они не подходят текущему черновику.
Проанализируй переданную историю генераций и выбери для нового поста Угол Подачи (applied_angle), отличный от тех, что использовались в последних задачах, чтобы контент не был монотонным.
Проанализируй семантическое ядро и конкретные сценарии: боли, мотивы, желания, ситуации и причины действия, которые использовались в переданной истории генераций.
Ты обязан выбрать совершенно новый смысловой вектор и другой сценарий.
Категорически запрещено повторять мотивы, которые доминируют в истории.

## уникальность

Ни текст, ни структура, ни метафоры не должны пересекаться с последними публикациями проекта.
Если в прошлых постах уже был похожий заход, сохрани скелет главного тренда, но измени сцену, угол и развитие мысли.
Не повторяй формулировки, порядок мыслей, сцены и концовки из памяти публикаций.

## brand safety

Не придумывай факты, события, места, цифры, людей, сущности или метафоры, которых нет во входных данных.
Никаких выдуманных "чоппер-парадов", "гонок", закрытых мероприятий и обещаний результата, если этого нет в описании проекта или черновике.
Запрещены оскорбления, провокации на срач, скам, дешевый кликбейт, грубый сленг и вульгарность.
Запрещены слова и обороты: "пожрать", "движуха", "безусловно", "в современном мире", "важно помнить", "представьте", "задумывались ли вы".
"""

STRUCTURED_OUTPUT_RULES = """
## формат ответа

Верни строго JSON без markdown, без пояснений и без текста вокруг.
Схема:
{
  "content": "готовый текст поста",
  "applied_angle": "выбранный фреймворк и логика его применения",
  "hook_mechanic": "как устроен хук и почему он должен зацепить",
  "structure_pattern": "какая структура использована: старт, мостик, суть, финал",
  "tone_and_rhythm": "какой тон и ритм использованы"
}

Все 5 полей обязательны.
В поле content должен быть только финальный пост.
"""


THREADS_LENGTH_RULES = f"""
## Threads length limit

This rule overrides any older instruction asking for 3-5 sentences or a full article-like paragraph.
Hard limit: content must be at most {THREADS_POST_CHAR_LIMIT} characters.
Target length: 160-220 characters.
Return exactly one concise post in content.
Never create a thread chain. Never return posts_chain.
Do not put analysis, labels, headings, metadata, or explanations into content.
Write like a live Threads post, not like an article.
Use 2-4 very short lines.
Put line breaks inside content. A blank line between micro-thoughts is allowed.
Avoid dense paragraphs, long explanations, and polished marketing copy.
Prefer one sharp observation, one concrete detail, and one soft ending.
"""


THREADS_LIVE_FEED_RULES = """
## Live Threads voice

Write like a real person posting into the Threads feed, not like a product case study.
The default post is a human observation, tiny confession, argument, question, irritation, or unfinished thought.
Do not repeat the same arc: "I struggled -> found a system/service/base -> life got easier -> see pinned/profile".
Do not mention the product, service, automation, base, CRM, profile, pinned post, or bio link in every post.
Most posts should work even if the reader never clicks anywhere, unless the project's configured conversion intensity explicitly requires a stronger lead.
CTA or redirect frequency must follow the project's configured conversion intensity.
For the next post, avoid product-solution language unless the user explicitly asked for it.
Words like "base", "system", "automation", "service", "CRM", "app" should not be the default resolution.
If you mention a tool, make it incidental, not the whole point.
Never resolve the post with vague magic phrases like "now I just look and know", "everything is automatic",
"I simply stopped", or "I created one base". Show a tiny believable behavior instead.
Do not blame the audience, customers, users, buyers, leads, or counterparties.
The tension can be annoying, but the author must stay fair.
Avoid generic wisdom lines like "the main skill is management" unless they are anchored in a small scene.

Avoid frozen openings and repeated phrases:
- "yesterday I read/saw a colleague"
- "a colleague wrote"
- "I immediately remembered"
- "I opened the feed"
- "details in the pinned post"
- "I explained it in the pinned post"
- "how it works is in my profile"
- "I created a base/system"
- "I stopped worrying after I found a service"
- "now everything goes automatically"

Use varied native Russian feed shapes:
- one uncomfortable thought
- one small scene from the day
- one question that people may argue with
- one anti-advice line
- one practical observation without a moral
- one quiet punchline
- one tiny operational detail without explaining the whole solution

Keep the tone slightly imperfect and spoken. Short lines are good. A little asymmetry is good.
Do not sound like a brochure, a motivational post, a startup landing page, or a lesson summary.
End with an open loop, a question, or a quiet punchline unless a conversion hint truly feels natural.
"""


THREADS_MODERN_LANGUAGE_RULES = """
## Современность языка

Слегка сдвинь речь в сторону живого современного Threads, но не превращай текст в подростковый спектакль.
Автор должен звучать как человек 20-35 лет, который нормально пишет в интернете: проще, быстрее, честнее.

Меньше миллениальских формул:
- "делюсь наблюдением"
- "важный инсайт"
- "в моменте"
- "состояние потока"
- "экологично"
- "упаковать смыслы"
- "точка роста"
- "личный бренд" без необходимости
- "забрать пользу"
- "это про..."

Больше живых форм:
- короткое бытовое наблюдение;
- конкретная странная деталь;
- фраза, которую реально можно отправить знакомому;
- спокойная ирония без клоунады;
- нормальные слова вместо маркетинговых заменителей.

Разрешен легкий современный разговорный язык: "ну", "хз", "странно", "честно", "вот тут", "почему-то",
если это подходит проекту и не выглядит нарочито.
Запрещено пытаться казаться "молодежным": не используй кринжовые вставки, мемные выкрики,
искусственное "лол", "жиза", "вайб", "имба", если этих слов нет в контексте проекта.

Главный критерий: текст должен звучать не как автор курса и не как SMM-специалист,
а как живой человек, который заметил вещь и написал ее без большой подготовки.
"""


THREADS_ENGAGEMENT_RULES = """
## Engagement-first rule

For cold or low-reach accounts, the first job is replies, not profile clicks.
The post must give a stranger a reason to react in the feed.

Every post needs at least one reply surface:
- a natural question people can answer from experience;
- a small disagreement people may push back on;
- a recognizable scene with unfinished tension;
- a concrete micro-detail that makes readers say "same";
- a useful tiny rule that other people can argue with.

Avoid closed diary posts that only state a private feeling and end there.
Avoid quiet one-person monologues where the reader has no obvious place to enter.
Avoid making every post about payment reminders. Rotate between schedule chaos, no-shows,
boundaries, parent/student communication, admin fatigue, client flow, money awkwardness,
and the feeling of being both teacher and manager.

At least half of generated posts should end with a native discussion door, but not a fake engagement-bait line.
Good endings:
- "у вас это тоже так работает?"
- "я одна так делаю?"
- "как вы это разруливаете?"
- "кажется, это вообще отдельная часть профессии"
- "и вот тут я каждый раз зависаю"

Bad endings:
- "пишите в комментарии";
- "согласны?";
- "ставьте лайк";
- hard CTA to profile, pinned post, bio, service, CRM, base, or automation.
"""


async def generate_post(
    project_id: int,
    topic_or_context: str,
    session: AsyncSession,
    *,
    platform: Platform = Platform.THREADS,
    account_id: int | None = None,
    scheduled_at: datetime | None = None,
    media_url: str | None = None,
    use_trends: bool = True,
) -> PostingTask:
    project = await session.get(Project, project_id)
    project_prompt = await build_system_prompt(project_id=project_id, session=session)
    trends = await _get_recent_successful_trends(project_id=project_id, session=session) if use_trends else []
    publication_memory = await _get_recent_generated_posts(project_id=project_id, session=session)
    project_stop_words = _normalize_project_stop_words(project)
    target_actions = _normalize_target_actions(project)
    conversion_mode = _normalize_conversion_mode(project)
    conversion_intensity = _normalize_conversion_intensity(project)
    generated_posts_count = await _count_generated_posts(project_id=project_id, session=session)
    conversion_required = _should_require_conversion_post(
        generated_posts_count=generated_posts_count,
        conversion_intensity=conversion_intensity,
        conversion_mode=conversion_mode,
    )

    system_prompt = _build_generation_system_prompt(
        project_prompt=project_prompt,
        project_description=_build_project_description(project),
        trends_context=_build_trends_context(trends),
        publication_memory=_build_publication_memory_context(publication_memory),
        project_stop_words=_build_project_stop_words_rule(project_stop_words),
        target_actions_rule=_build_target_actions_rule(
            target_actions,
            conversion_intensity,
            conversion_required=conversion_required,
        ),
        conversion_rule=_build_conversion_rule(
            conversion_mode=conversion_mode,
            conversion_target=(project.conversion_target if project else None),
            conversion_intensity=conversion_intensity,
            conversion_required=conversion_required,
        ),
        topic=topic_or_context,
    )
    client = get_deepinfra_client()

    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": topic_or_context},
    ]
    parsed_response = await _generate_validated_response(
        client=client,
        messages=messages,
        project_id=project_id,
        stop_words=project_stop_words,
        conversion_intensity=conversion_intensity,
        conversion_required=conversion_required,
        conversion_mode=conversion_mode,
        conversion_target=(project.conversion_target if project else None),
        target_actions=target_actions,
    )
    generated_text = _prepare_generated_text_for_threads(
        _clean_generated_text(parsed_response["content"]),
        conversion_intensity=conversion_intensity,
        conversion_required=conversion_required,
        conversion_mode=conversion_mode,
        conversion_target=(project.conversion_target if project else None),
        target_actions=target_actions,
    )
    generation_metadata = {
        "applied_angle": parsed_response["applied_angle"],
        "hook_mechanic": parsed_response["hook_mechanic"],
        "structure_pattern": parsed_response["structure_pattern"],
        "tone_and_rhythm": parsed_response["tone_and_rhythm"],
        "primary_trend_id": trends[0].id if trends else None,
        "trends_used_count": len(trends),
        "publication_memory_used_count": len(publication_memory),
        "target_actions_count": len(target_actions),
        "conversion_mode": conversion_mode,
        "conversion_intensity": conversion_intensity,
        "conversion_required": conversion_required,
        "conversion_slot_number": generated_posts_count + 1,
        "conversion_target": (project.conversion_target if project else None),
        "validation_attempts": parsed_response.get("_validation_attempts", "1"),
    }
    posting_task = PostingTask(
        project_id=project_id,
        account_id=account_id,
        platform=platform,
        content_text=generated_text,
        posts_chain=[generated_text],
        media_url=media_url,
        status=PostingTaskStatus.QUEUED,
        scheduled_at=scheduled_at,
        generation_metadata=generation_metadata,
    )
    session.add(posting_task)
    await session.commit()
    await session.refresh(posting_task)

    return posting_task


async def _get_recent_successful_trends(project_id: int, session: AsyncSession) -> list[SavedTrend]:
    stmt = (
        select(SavedTrend)
        .where(SavedTrend.project_id == project_id)
        .order_by(SavedTrend.virality_score.desc().nullslast(), SavedTrend.created_at.desc())
        .limit(MAX_TRENDS_FOR_SMART_SELECTION)
    )
    return list((await session.scalars(stmt)).all())


async def _get_recent_generated_posts(project_id: int, session: AsyncSession) -> list[dict[str, str]]:
    stmt = (
        select(PostingTask.content_text, PostingTask.generation_metadata, PostingTask.status)
        .where(
            PostingTask.project_id == project_id,
            PostingTask.content_text.is_not(None),
        )
        .order_by(PostingTask.created_at.desc())
        .limit(MAX_PUBLICATION_MEMORY_ITEMS)
    )
    rows = (await session.execute(stmt)).all()
    history: list[dict[str, str]] = []

    for content_text, generation_metadata, status in rows:
        if not content_text:
            continue

        metadata = generation_metadata if isinstance(generation_metadata, dict) else {}
        history.append(
            {
                "content": str(content_text),
                "applied_angle": str(metadata.get("applied_angle") or "не указан"),
                "status": getattr(status, "value", str(status)),
            }
        )

    return history


async def _count_generated_posts(project_id: int, session: AsyncSession) -> int:
    count = await session.scalar(
        select(func.count(PostingTask.id)).where(
            PostingTask.project_id == project_id,
            PostingTask.content_text.is_not(None),
        )
    )
    return int(count or 0)


def _should_require_conversion_post(
    *,
    generated_posts_count: int,
    conversion_intensity: int,
    conversion_mode: str,
) -> bool:
    if conversion_mode == "none" or conversion_intensity <= 0:
        return False
    if conversion_intensity >= 100:
        return True

    before_current_post = (generated_posts_count * conversion_intensity) // 100
    after_current_post = ((generated_posts_count + 1) * conversion_intensity) // 100
    return after_current_post > before_current_post


def _build_trends_context(trends: list[SavedTrend]) -> str:
    if not trends:
        return "Свежих трендов пока нет. Не имитируй тренды, опирайся на описание проекта, черновик и память публикаций."

    primary_trend = trends[0]
    additional_trends = trends[1:]
    sections = [
        "## главный тренд-скелет",
        _format_trend(primary_trend, index=1),
        "Инструкция: именно этот тренд является скелетом. Возьми его ритм, структуру хука и динамику, но не копируй тему и формулировки.",
    ]

    if additional_trends:
        sections.append("## дополнительные тренды-фон")
        for index, trend in enumerate(additional_trends, start=2):
            sections.append(_format_trend(trend, index=index))

    return "\n\n".join(sections)


def _format_trend(trend: SavedTrend, *, index: int) -> str:
    return "\n".join(
        [
            f"Тренд #{index}",
            f"id: {trend.id}",
            f"оценка успешности: {trend.virality_score or 'нет данных'}",
            f"механика хука: {trend.hook_mechanic or trend.hook_analysis or 'нет данных'}",
            f"структура: {trend.structure_pattern or 'нет данных'}",
            f"тон и ритм: {trend.tone_and_rhythm or 'нет данных'}",
            f"живые речевые обороты: {_format_list_for_prompt(trend.living_phrases)}",
            f"не переносить смысловую зону: {_format_list_for_prompt(trend.semantic_forbidden_zone)}",
        ]
    )


def _format_list_for_prompt(items: list[str] | None) -> str:
    if not items:
        return "нет данных"

    clean_items = [item.strip() for item in items if item.strip()]
    return "; ".join(clean_items) if clean_items else "нет данных"


def _build_publication_memory_context(posts: list[dict[str, str]]) -> str:
    if not posts:
        return "Прошлых генераций пока нет."

    overused_openings = _detect_overused_openings(posts)
    sections = [
        "Последние тексты проекта ниже являются анти-памятью, а не примерами для копирования. "
        "Нельзя повторять их сцену, заход, первую фразу, конфликт, applied_angle и бытовую механику. "
        "Если несколько прошлых постов начинались через коллегу, ленту, чужую цитату или вопрос другого человека, "
        "следующий пост обязан начинаться иначе: через личное действие, конкретный момент дня, интерфейс, оплату, календарь, клиента, заметку, ошибку или наблюдение."
    ]
    sections.append(
        "Anti-memory in plain terms: do not reuse the repeated motifs from the recent posts. "
        "If the recent queue contains colleague/yesterday/feed/payment/base/pinned/profile/service language, "
        "treat those motifs as temporarily banned. Move to a different scene, rhythm, and ending."
    )

    if overused_openings:
        sections.append(
            "Перегретые заходы, которые сейчас запрещены: "
            + "; ".join(overused_openings)
            + ". Не используй их в новом посте."
        )

    overused_topics = _detect_overused_topics(posts)
    if overused_topics:
        sections.append(
            "Перегретые смысловые зоны, которые сейчас нужно временно отложить: "
            + "; ".join(overused_topics)
            + ". Новый пост обязан выбрать другую боль, сцену и социальный крючок."
        )

    for index, post in enumerate(posts, start=1):
        sections.append(
            "\n".join(
                [
                    f"Генерация #{index}",
                    f"статус: {post['status']}",
                    f"applied_angle: {post['applied_angle']}",
                    f"текст: {post['content'][:1000]}",
                ]
            )
        )

    return "\n\n".join(sections)


def _detect_overused_openings(posts: list[dict[str, str]]) -> list[str]:
    recent_texts = [post["content"].lower() for post in posts[:8] if post.get("content")]
    patterns = [
        ("коллега/коллеги в ленте", ("коллег",)),
        ("чужой пост или цитата в начале", ("читаю пост", "прочитала пост", "листаю ленту", "в ленте")),
        ("вчера как основной старт", ("вчера",)),
    ]
    overheated: list[str] = []

    for label, needles in patterns:
        count = sum(1 for text in recent_texts if any(needle in text for needle in needles))
        if count >= 2:
            overheated.append(label)

    return overheated


def _detect_overused_topics(posts: list[dict[str, str]]) -> list[str]:
    recent_texts = [post["content"].lower() for post in posts[:10] if post.get("content")]
    patterns = [
        ("оплата / долг / напоминание о деньгах", ("оплат", "долг", "деньг", "перевел", "перевести")),
        ("отмена занятия в последний момент", ("отмен", "пустой слот", "освободился слот")),
        ("хаос в расписании", ("расписан", "слот", "календар", "время занятия")),
        ("ученик говорит / ученик забыл", ("ученик говорит", "ученик забыл", "человек вообще помнит")),
        ("закреп / профиль / ссылка", ("закреп", "профил", "ссылка")),
        ("база / система / автоматизация", ("база", "систем", "автомат")),
    ]
    overheated: list[str] = []

    for label, needles in patterns:
        count = sum(1 for text in recent_texts if any(needle in text for needle in needles))
        if count >= 3:
            overheated.append(label)

    return overheated


def _build_project_description(project: Project | None) -> str:
    if project is None:
        return "Описание проекта недоступно."

    global_context = (project.global_context or "").strip()
    legacy_context_parts = [
        project.description,
        project.target_audience,
        project.tone_of_voice,
        project.product_context,
    ]
    legacy_context = "\n".join(part.strip() for part in legacy_context_parts if part and part.strip())

    parts = [
        f"название проекта: {project.name}",
        f"global_context: {global_context or legacy_context or 'не указан'}",
        f"ниша: {project.niche or 'не указана'}",
        f"conversion_mode: {_normalize_conversion_mode(project)}",
        f"conversion_target: {(project.conversion_target or '').strip() or 'not specified'}",
        f"conversion_intensity: {_normalize_conversion_intensity(project)}/100",
    ]
    return "\n".join(parts)


def _normalize_project_stop_words(project: Project | None) -> list[str]:
    raw_stop_words = project.stop_words if project else []
    return list(dict.fromkeys(word.strip() for word in raw_stop_words if word.strip()))


def _normalize_target_actions(project: Project | None) -> list[str]:
    raw_actions = project.target_actions if project else []
    return list(dict.fromkeys(action.strip() for action in raw_actions if action and action.strip()))


def _normalize_conversion_mode(project: Project | None) -> str:
    mode = (project.conversion_mode if project else "bio_link") or "bio_link"
    return mode if mode in {"bio_link", "pinned_post", "none"} else "bio_link"


def _normalize_conversion_intensity(project: Project | None) -> int:
    raw_value = project.conversion_intensity if project else 25
    return max(0, min(100, int(raw_value or 0)))


def _build_project_stop_words_rule(stop_words: list[str]) -> str:
    if not stop_words:
        return "Для этого проекта индивидуальные стоп-слова не заданы."

    joined_stop_words = ", ".join(stop_words)
    return (
        "## project-specific taboo words\n\n"
        "CRITICAL: YOU MUST NEVER USE THESE STRUCTURAL AND CONTENT WORDS IN THE POST TEXT: "
        f"{joined_stop_words}.\n"
        "Найди им адекватную замену или перестрой фразу так, чтобы эти слова не понадобились."
    )


def _build_target_actions_rule(
    target_actions: list[str],
    conversion_intensity: int,
    *,
    conversion_required: bool,
) -> str:
    if not target_actions:
        if conversion_required:
            return (
                "## правило для финала поста\n\n"
                "THIS POST IS A CONVERSION SLOT. В проекте не задан список целевых действий, "
                "поэтому нативно заверши пост мягким переходом к выбранному месту конверсии "
                "(профиль, био или закреп — смотри conversion strategy). Не оставляй пост без следующего шага."
            )
        return (
            "## правило для финала поста\n\n"
            "Для этого проекта список целевых действий не задан. Заверши пост естественно: мягким финалом, "
            "понятным следующим шагом или спокойной открытой фразой, если CTA не нужен."
        )

    joined_actions = "\n".join(f"- {action}" for action in target_actions)
    intensity_rule = _build_intensity_rule(conversion_intensity)
    if conversion_required:
        slot_rule = (
            "THIS POST IS A CONVERSION SLOT. You MUST choose exactly one target action from the list "
            "and naturally integrate it into the ending. Do not skip the target action. "
            "Before the target action, add a native bridge: explain why the reader may need the next step "
            "based on the exact tension of the post. The ending must feel like a continuation of the story, "
            "not like a pasted ad line."
        )
    else:
        slot_rule = (
            "THIS POST IS NOT A CONVERSION SLOT. Do not use target actions in this post. "
            "Keep it useful, engaging, and native without redirecting the reader."
        )
    return (
        "## правило для финала поста\n\n"
        "У тебя есть список целевых действий:\n"
        f"{joined_actions}\n\n"
        f"{intensity_rule} "
        f"{slot_rule} "
        "Use at most one target action in a post. Even at high intensity, make the transition feel native "
        "and avoid command-like, repetitive CTA wording."
    )


def _build_conversion_rule(
    *,
    conversion_mode: str,
    conversion_target: str | None,
    conversion_intensity: int,
    conversion_required: bool,
) -> str:
    target = (conversion_target or "").strip()
    target_line = f"Known conversion asset: {target}" if target else "Known conversion asset: not specified."

    if conversion_mode == "none":
        return (
            "## conversion strategy\n\n"
            "The project does not use an explicit redirect destination for this post. "
            "Do not mention links, bio, profile links, pinned posts, funnels, lead magnets, or 'go to my profile'. "
            "End naturally with a useful thought, a sharp open loop, or a discussion question."
        )

    slot_line = (
        "CURRENT SLOT: CONVERSION REQUIRED. This exact post must contain one native redirect. "
        "Do not treat conversion as optional. The redirect must be prepared by a native bridge: "
        "first name the problem, tension, or useful next step from the post, then point to the profile/pinned post. "
        "Never paste a naked final line like 'left the name in profile' without explaining why it belongs there."
        if conversion_required
        else "CURRENT SLOT: CONVERSION NOT REQUIRED. This exact post should not redirect the reader."
    )

    if conversion_mode == "pinned_post":
        destination_rule = (
            "For conversion slots, point curiosity toward the profile or pinned post, not toward a bio link. "
            "Never write a hard CTA like 'click now' or 'buy now'."
        )
    else:
        destination_rule = (
            "For conversion slots, point curiosity toward the profile or bio link. "
            "Never write a hard CTA like 'click now' or 'buy now'."
        )

    return (
        "## conversion strategy\n\n"
        f"Configured conversion intensity: {conversion_intensity}/100. "
        f"{_build_intensity_rule(conversion_intensity)} "
        f"{slot_line} "
        "Traffic strategy: preserve trust and liveliness even when conversion intensity is high. "
        "The post must be interesting by itself and should not feel like an ad, lesson, funnel, or feature pitch. "
        "At most one soft hint is allowed in a post. If CURRENT SLOT requires conversion, the hint must be present.\n"
        f"{target_line}\n"
        f"{destination_rule} "
        "Native conversion structure for required slots: observation or pain -> why the next step matters -> soft redirect. "
        "The conversion sentence must answer 'why should the reader go there now?' in human language. "
        "Bad native bridge: 'The service name is in my profile.' "
        "Good native bridge: 'If you also mix clients between projects, I left the tool I use in the profile.' "
        "Allowed rare patterns: 'I left the fuller breakdown in the profile', "
        "'the detailed version is pinned in the profile', "
        "'I keep the working notes there'. "
        "Bad patterns: spammy CTAs, repeated sales language, direct promises, forcing the same ending every time, "
        "and Russian endings like 'detali v zakrepe', 'raspisala v zakreplennom', 'ssylka v bio'."
    )


def _build_intensity_rule(conversion_intensity: int) -> str:
    if conversion_intensity <= 0:
        return "Do not include a target action or conversion hint in this post."
    if conversion_intensity <= 25:
        return "Target actions are rare and optional; use one only when it feels completely natural."
    if conversion_intensity <= 50:
        return "Aim to lead roughly half of generated posts toward one target action; this post may stay purely engaging."
    if conversion_intensity <= 75:
        return "Most generated posts should gently lead toward one target action, but a natural discussion post is still allowed."
    if conversion_intensity < 100:
        return "Almost every generated post should gently lead toward one target action."
    return "Every generated post must gently lead toward one target action without sounding like an advertisement."


def _build_generation_system_prompt(
    *,
    project_prompt: str,
    project_description: str,
    trends_context: str,
    publication_memory: str,
    project_stop_words: str,
    target_actions_rule: str,
    conversion_rule: str,
    topic: str,
) -> str:
    return "\n\n".join(
        [
            project_prompt,
            "## описание проекта",
            project_description,
            "## черновик пользователя",
            topic,
            "## память публикаций",
            publication_memory,
            "## трендовый материал",
            trends_context,
            THREADS_VIBE_RULES,
            THREADS_LENGTH_RULES,
            THREADS_LIVE_FEED_RULES,
            THREADS_MODERN_LANGUAGE_RULES,
            THREADS_ENGAGEMENT_RULES,
            project_stop_words,
            conversion_rule,
            target_actions_rule,
            STRUCTURED_OUTPUT_RULES,
        ]
    )


async def _generate_validated_response(
    *,
    client: Any,
    messages: list[dict[str, str]],
    project_id: int,
    stop_words: list[str],
    conversion_intensity: int,
    conversion_required: bool,
    conversion_mode: str,
    conversion_target: str | None,
    target_actions: list[str],
) -> dict[str, str]:
    last_response: dict[str, str] | None = None
    last_forbidden_words: list[str] = []
    last_quality_issues: list[str] = []

    for attempt in range(1, MAX_GENERATION_ATTEMPTS + 1):
        response = await client.chat.completions.create(
            model=DEEPINFRA_MODEL,
            response_format={"type": "json_object"},
            messages=messages,
        )
        parsed_response = _parse_generation_response(response.choices[0].message.content or "")
        parsed_response["_validation_attempts"] = str(attempt)
        last_response = parsed_response
        content_length = len(parsed_response["content"])

        forbidden_words = _find_forbidden_words(
            content=parsed_response["content"],
            stop_words=stop_words,
        )
        quality_issues = _find_generation_quality_issues(
            parsed_response["content"],
            conversion_intensity=conversion_intensity,
            conversion_required=conversion_required,
            conversion_mode=conversion_mode,
            conversion_target=conversion_target,
            target_actions=target_actions,
        )
        if not forbidden_words and not quality_issues and content_length <= THREADS_POST_CHAR_LIMIT:
            return parsed_response

        last_forbidden_words = forbidden_words
        last_quality_issues = quality_issues
        if forbidden_words:
            logger.warning(
                "Generated post for project_id=%s used forbidden words on attempt %s/%s: %s",
                project_id,
                attempt,
                MAX_GENERATION_ATTEMPTS,
                ", ".join(forbidden_words),
            )
        if content_length > THREADS_POST_CHAR_LIMIT:
            logger.warning(
                "Generated post for project_id=%s exceeded Threads length on attempt %s/%s: %s characters.",
                project_id,
                attempt,
                MAX_GENERATION_ATTEMPTS,
                content_length,
            )
        if quality_issues:
            logger.warning(
                "Generated post for project_id=%s failed quality checks on attempt %s/%s: %s",
                project_id,
                attempt,
                MAX_GENERATION_ATTEMPTS,
                "; ".join(quality_issues),
            )

        if attempt < MAX_GENERATION_ATTEMPTS:
            retry_reasons: list[str] = []
            if forbidden_words:
                retry_reasons.append(
                    "You used forbidden words: " + ", ".join(forbidden_words) + ". Remove them entirely."
                )
            if content_length > THREADS_POST_CHAR_LIMIT:
                retry_reasons.append(
                    f"Your content is {content_length} characters. Rewrite it to <= {THREADS_POST_CHAR_LIMIT} characters."
                )
            if quality_issues:
                retry_reasons.append(
                    "Quality issues: "
                    + "; ".join(quality_issues)
                    + ". Rewrite with a concrete human detail, no vague magic resolution, "
                    "and obey the exact conversion slot requirement."
                )
            messages.append(
                {
                    "role": "system",
                    "content": (
                        "SYSTEM ERROR: "
                        + " ".join(retry_reasons)
                        + " Completely rewrite the post in JSON. "
                        "Keep the same JSON schema with content, applied_angle, hook_mechanic, "
                        "structure_pattern, tone_and_rhythm."
                    ),
                }
            )

    if last_forbidden_words:
        logger.error(
            "Generated post for project_id=%s still contains forbidden words after %s attempts: %s",
            project_id,
            MAX_GENERATION_ATTEMPTS,
            ", ".join(last_forbidden_words),
        )
    elif last_response is not None and len(last_response["content"]) > THREADS_POST_CHAR_LIMIT:
        logger.error(
            "Generated post for project_id=%s still exceeds Threads length after %s attempts: %s characters.",
            project_id,
            MAX_GENERATION_ATTEMPTS,
            len(last_response["content"]),
        )
    elif last_quality_issues:
        logger.error(
            "Generated post for project_id=%s still failed quality checks after %s attempts: %s",
            project_id,
            MAX_GENERATION_ATTEMPTS,
            "; ".join(last_quality_issues),
        )

    if last_response is None:
        return {
            "content": "",
            "applied_angle": "подход не указан",
            "hook_mechanic": "анализ хука не сохранен",
            "structure_pattern": "анализ структуры не сохранен",
            "tone_and_rhythm": "анализ ритма не сохранен",
            "_validation_attempts": str(MAX_GENERATION_ATTEMPTS),
        }

    return last_response


def _parse_generation_response(raw_content: str) -> dict[str, str]:
    try:
        payload = json.loads(raw_content)
    except json.JSONDecodeError:
        payload = _extract_json_object(raw_content)

    if not isinstance(payload, dict):
        payload = {}

    content = str(payload.get("content") or raw_content).strip()
    return {
        "content": content,
        "applied_angle": str(payload.get("applied_angle") or "подход не указан").strip(),
        "hook_mechanic": str(payload.get("hook_mechanic") or "анализ хука не сохранен").strip(),
        "structure_pattern": str(payload.get("structure_pattern") or "анализ структуры не сохранен").strip(),
        "tone_and_rhythm": str(payload.get("tone_and_rhythm") or "анализ ритма не сохранен").strip(),
    }


def _extract_json_object(raw_content: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", raw_content, flags=re.DOTALL)
    if not match:
        return {}

    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}

    return payload if isinstance(payload, dict) else {}


def _find_forbidden_words(*, content: str, stop_words: list[str]) -> list[str]:
    lowered_content = content.lower()
    found_words: list[str] = []

    for stop_word in stop_words:
        lowered_stop_word = stop_word.lower()
        if not lowered_stop_word:
            continue

        if lowered_stop_word in lowered_content:
            found_words.append(stop_word)

    return found_words


def _find_generation_quality_issues(
    content: str,
    *,
    conversion_intensity: int = 25,
    conversion_required: bool = False,
    conversion_mode: str = "bio_link",
    conversion_target: str | None = None,
    target_actions: list[str] | None = None,
) -> list[str]:
    lowered = " ".join(content.lower().split())
    issues: list[str] = []

    vague_magic_patterns = [
        "потом просто перестала",
        "сейчас просто",
        "теперь просто",
        "просто открываю",
        "просто смотрю",
        "просто знаю",
        "просто запоминаю",
        "просто перестала",
        "просто решила",
        "слоты видны",
        "без гаданий",
        "ровную картину",
        "всё само",
        "все само",
        "одна база",
        "одну базу",
        "завела базу",
    ]
    if any(pattern in lowered for pattern in vague_magic_patterns):
        issues.append("vague product/magic resolution")

    if lowered.count("просто") >= 2:
        issues.append("too many 'просто' shortcuts")

    blaming_patterns = [
        "кто из нас плохой",
        "они виноваты",
        "клиенты виноваты",
        "покупатели виноваты",
        "аудитория виновата",
        "пользователи виноваты",
    ]
    if any(pattern in lowered for pattern in blaming_patterns):
        issues.append("blames the audience instead of showing fair tension")

    generic_wisdom_patterns = [
        "главный навык",
        "выживают те",
        "это грустный факт",
    ]
    if any(pattern in lowered for pattern in generic_wisdom_patterns) and len(lowered) < 180:
        issues.append("generic wisdom without a scene")

    reply_surface_markers = [
        "у вас",
        "у кого",
        "я одна",
        "вы как",
        "как вы",
        "почему",
        "нормально ли",
        "кажется",
        "вот тут",
        "каждый раз",
        "отдельная часть профессии",
        "мое правило",
        "моё правило",
    ]
    has_direct_question = lowered.rstrip().endswith("?")
    if not has_direct_question and not any(marker in lowered for marker in reply_surface_markers):
        issues.append("closed post without a clear reply surface")

    product_resolution_markers = [
        "завела себе одну базу",
        "завела базу",
        "нашла сервис",
        "стоит система",
        "в закреп",
        "в профиле",
        "по ссылке",
    ]
    if not conversion_required and conversion_intensity <= 25 and any(marker in lowered for marker in product_resolution_markers):
        issues.append("too direct product/profile resolution for a low-reach feed post")
    if conversion_required and not _has_conversion_signal(
        content,
        conversion_mode=conversion_mode,
        conversion_target=conversion_target,
        target_actions=target_actions or [],
    ):
        issues.append("missing required conversion redirect")
    if conversion_required and _has_weak_conversion_bridge(
        content,
        conversion_mode=conversion_mode,
        conversion_target=conversion_target,
        target_actions=target_actions or [],
    ):
        issues.append("conversion redirect is pasted without a native bridge")

    return issues


def _has_conversion_signal(
    content: str,
    *,
    conversion_mode: str,
    conversion_target: str | None,
    target_actions: list[str],
) -> bool:
    lowered = " ".join(content.lower().split())
    markers = _get_conversion_markers(
        conversion_mode=conversion_mode,
        conversion_target=conversion_target,
        target_actions=target_actions,
    )
    return any(marker in lowered for marker in markers)


def _get_conversion_markers(
    *,
    conversion_mode: str,
    conversion_target: str | None,
    target_actions: list[str],
) -> list[str]:
    markers: list[str] = []
    if conversion_mode == "pinned_post":
        markers.extend(["закреп", "закреплен", "закреплён", "прикреплен", "прикреплён"])
    elif conversion_mode == "bio_link":
        markers.extend(["профил", "био", "bio", "ссылк", "линк"])

    target = (conversion_target or "").strip().lower()
    if target:
        markers.extend(part for part in re.split(r"[\s/.,;:!?()#?=&_-]+", target) if len(part) >= 4)

    for action in target_actions:
        for part in re.split(r"[\s/.,;:!?()#?=&_-]+", action.lower()):
            if len(part) >= 5:
                markers.append(part)

    return list(dict.fromkeys(markers))


def _has_weak_conversion_bridge(
    content: str,
    *,
    conversion_mode: str,
    conversion_target: str | None,
    target_actions: list[str],
) -> bool:
    if not _has_conversion_signal(
        content,
        conversion_mode=conversion_mode,
        conversion_target=conversion_target,
        target_actions=target_actions,
    ):
        return False

    normalized = " ".join(content.lower().split())
    naked_patterns = [
        "название сервиса оставила в профиле",
        "название оставила в профиле",
        "сервис оставила в профиле",
        "оставила в профиле",
        "оставил в профиле",
        "подробности в профиле",
        "детали в профиле",
        "ссылка в био",
        "ссылка в профиле",
        "все в закрепе",
        "детали в закрепе",
        "подробности в закрепе",
    ]
    if any(pattern in normalized for pattern in naked_patterns):
        bridge_markers = [
            "если",
            "когда",
            "кому",
            "чтобы",
            "потому",
            "поэтому",
            "если у вас",
            "если тебе",
            "для тех",
            "в таких случаях",
            "вот тут",
            "чтобы не",
            "я для этого",
            "мне для этого",
        ]
        return not any(marker in normalized for marker in bridge_markers)

    return False


def _clean_generated_text(text: str) -> str:
    cleaned = text.strip().strip('"').strip("'")

    # Safety net only: if the model accidentally put JSON fragments into content,
    # remove wrappers without rewriting the post itself.
    cleaned = re.sub(r"^\s*```(?:json)?", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"```\s*$", "", cleaned)
    cleaned = re.sub(r'^\s*"?(content|text|post)"?\s*:\s*', "", cleaned, flags=re.IGNORECASE)

    lines = []
    for raw_line in cleaned.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        lines.append(line)

    cleaned = "\n".join(lines).strip()
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"(?<!\w)#\w+", "", cleaned, flags=re.UNICODE)
    cleaned = re.sub(r"\s+([,.!?])", r"\1", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    return cleaned.strip()


def _prepare_generated_text_for_threads(
    text: str,
    *,
    conversion_intensity: int = 25,
    conversion_required: bool = False,
    conversion_mode: str = "bio_link",
    conversion_target: str | None = None,
    target_actions: list[str] | None = None,
) -> str:
    target_actions = target_actions or []
    if not conversion_required and conversion_intensity <= 25:
        text = _remove_stale_conversion_tail(text)
    if conversion_required and not _has_conversion_signal(
        text,
        conversion_mode=conversion_mode,
        conversion_target=conversion_target,
        target_actions=target_actions,
    ):
        text = _append_conversion_fallback(
            text,
            conversion_mode=conversion_mode,
            target_actions=target_actions,
        )
    fitted = _fit_generated_text_for_threads(text)
    return _format_generated_text_lines(fitted)


def _append_conversion_fallback(
    text: str,
    *,
    conversion_mode: str,
    target_actions: list[str],
) -> str:
    if target_actions:
        action = target_actions[0].strip().rstrip(".")
        fallback = f"Если у тебя похожая история, {action[0].lower() + action[1:] if action else action}"
    elif conversion_mode == "pinned_post":
        fallback = "Если хочется разобраться без лишнего шума, подробности оставил в закрепленном посте"
    else:
        fallback = "Если у тебя такое тоже всплывает в работе, подробности оставил в профиле"

    if not fallback:
        return text

    candidate = f"{text.strip()}\n\n{fallback}."
    if len(candidate) <= THREADS_POST_CHAR_LIMIT:
        return candidate

    reserved = len(fallback) + 5
    shortened = _fit_generated_text_for_threads(text, limit=max(80, THREADS_POST_CHAR_LIMIT - reserved))
    return f"{shortened.rstrip('.')}\n\n{fallback}."


def _remove_stale_conversion_tail(text: str) -> str:
    lines = [line.strip() for line in text.strip().splitlines()]
    while lines and not lines[-1]:
        lines.pop()

    stale_tail_patterns = [
        r"^(детали|подробности|разбор|как это устроено).{0,80}(закреп|закреплен|профил|био|bio|profile)",
        r"^(оставил[аи]?|расписал[аи]?).{0,80}(закреп|профил|био|bio|profile)",
        r"^(ссылка|линк).{0,80}(био|профил|bio|profile)",
    ]
    while lines:
        last_line = lines[-1].strip().lower().rstrip(".!?:; ")
        if any(re.search(pattern, last_line, flags=re.IGNORECASE) for pattern in stale_tail_patterns):
            lines.pop()
            continue
        break

    cleaned = "\n".join(lines).strip()
    return cleaned or text.strip()


def _fit_generated_text_for_threads(text: str, limit: int = THREADS_POST_CHAR_LIMIT) -> str:
    cleaned = text.strip()
    if len(cleaned) <= limit:
        return cleaned

    single_line = " ".join(cleaned.split())
    if len(single_line) <= limit:
        return single_line

    cut_at = max(
        single_line.rfind(". ", 0, limit),
        single_line.rfind("! ", 0, limit),
        single_line.rfind("? ", 0, limit),
        single_line.rfind("; ", 0, limit),
        single_line.rfind(", ", 0, limit),
        single_line.rfind(" ", 0, limit),
    )
    if cut_at < int(limit * 0.6):
        cut_at = limit

    suffix = "..."
    fitted = single_line[: max(1, cut_at - len(suffix))].strip()
    return fitted.rstrip(".,;: ") + suffix


def _format_generated_text_lines(text: str, limit: int = THREADS_POST_CHAR_LIMIT) -> str:
    if "\n" in text:
        return text

    parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]
    if len(parts) < 2:
        return text

    selected_parts: list[str] = []
    for part in parts[:4]:
        candidate = "\n\n".join([*selected_parts, part])
        if len(candidate) > limit:
            break
        selected_parts.append(part)

    return "\n\n".join(selected_parts) if len(selected_parts) >= 2 else text

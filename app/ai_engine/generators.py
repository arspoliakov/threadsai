from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_engine.client import DEEPINFRA_MODEL, get_deepinfra_client
from app.ai_engine.prompt_builder import build_system_prompt
from app.db.models import Platform, PostingTask, PostingTaskStatus, Project, SavedTrend


MAX_TRENDS_FOR_SMART_SELECTION = 10
MAX_PUBLICATION_MEMORY_ITEMS = 10
MAX_GENERATION_ATTEMPTS = 3

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

    system_prompt = _build_generation_system_prompt(
        project_prompt=project_prompt,
        project_description=_build_project_description(project),
        trends_context=_build_trends_context(trends),
        publication_memory=_build_publication_memory_context(publication_memory),
        project_stop_words=_build_project_stop_words_rule(project_stop_words),
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
    )
    generated_text = _clean_generated_text(parsed_response["content"])
    generation_metadata = {
        "applied_angle": parsed_response["applied_angle"],
        "hook_mechanic": parsed_response["hook_mechanic"],
        "structure_pattern": parsed_response["structure_pattern"],
        "tone_and_rhythm": parsed_response["tone_and_rhythm"],
        "primary_trend_id": trends[0].id if trends else None,
        "trends_used_count": len(trends),
        "publication_memory_used_count": len(publication_memory),
        "validation_attempts": parsed_response.get("_validation_attempts", "1"),
    }
    posting_task = PostingTask(
        project_id=project_id,
        account_id=account_id,
        platform=platform,
        content_text=generated_text,
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

    sections = [
        "Последние 10 сгенерированных текстов проекта в любых статусах. Используй их как память, чтобы не повторять структуру, заход и applied_angle."
    ]
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


def _build_project_description(project: Project | None) -> str:
    if project is None:
        return "Описание проекта недоступно."

    parts = [
        f"название проекта: {project.name}",
        f"описание: {project.description or 'не указано'}",
        f"ниша: {project.niche or 'не указана'}",
        f"целевая аудитория: {project.target_audience or 'не указана'}",
        f"tone of voice: {project.tone_of_voice or 'не указан'}",
        f"контекст продукта: {project.product_context or 'не указан'}",
    ]
    return "\n".join(parts)


def _normalize_project_stop_words(project: Project | None) -> list[str]:
    raw_stop_words = project.stop_words if project else []
    return list(dict.fromkeys(word.strip() for word in raw_stop_words if word.strip()))


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


def _build_generation_system_prompt(
    *,
    project_prompt: str,
    project_description: str,
    trends_context: str,
    publication_memory: str,
    project_stop_words: str,
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
            project_stop_words,
            STRUCTURED_OUTPUT_RULES,
        ]
    )


async def _generate_validated_response(
    *,
    client: Any,
    messages: list[dict[str, str]],
    project_id: int,
    stop_words: list[str],
) -> dict[str, str]:
    last_response: dict[str, str] | None = None
    last_forbidden_words: list[str] = []

    for attempt in range(1, MAX_GENERATION_ATTEMPTS + 1):
        response = await client.chat.completions.create(
            model=DEEPINFRA_MODEL,
            response_format={"type": "json_object"},
            messages=messages,
        )
        parsed_response = _parse_generation_response(response.choices[0].message.content or "")
        parsed_response["_validation_attempts"] = str(attempt)
        last_response = parsed_response

        forbidden_words = _find_forbidden_words(
            content=parsed_response["content"],
            stop_words=stop_words,
        )
        if not forbidden_words:
            return parsed_response

        last_forbidden_words = forbidden_words
        logger.warning(
            "Generated post for project_id=%s used forbidden words on attempt %s/%s: %s",
            project_id,
            attempt,
            MAX_GENERATION_ATTEMPTS,
            ", ".join(forbidden_words),
        )

        if attempt < MAX_GENERATION_ATTEMPTS:
            messages.append(
                {
                    "role": "system",
                    "content": (
                        "SYSTEM ERROR: You violated the rules and used forbidden words: "
                        f"{', '.join(forbidden_words)}. "
                        "Completely rewrite the post in JSON, removing these words entirely. "
                        "Keep the same JSON schema with content, applied_angle, hook_mechanic, "
                        "structure_pattern, tone_and_rhythm."
                    ),
                }
            )

    logger.error(
        "Generated post for project_id=%s still contains forbidden words after %s attempts: %s",
        project_id,
        MAX_GENERATION_ATTEMPTS,
        ", ".join(last_forbidden_words),
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
    cleaned = re.sub(r"\s+([,.!?])", r"\1", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    return cleaned.strip()

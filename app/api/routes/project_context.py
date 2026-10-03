import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.api.auth import limiter
from app.api.deps import require_active_subscription
from app.db.models import User
from app.services.project_context_assistant import ContextAnswers, ContextPreview, generate_context_preview

router = APIRouter(prefix="/project-context", tags=["project-context"])
logger = logging.getLogger(__name__)
_working_users: set[int] = set()


async def assistant_user(request: Request, user: User = Depends(require_active_subscription)) -> User:
    request.state.project_context_user = user.id
    return user


def limit_key(request: Request) -> str:
    return f"project-context:{request.state.project_context_user}"


@router.post("/preview", response_model=ContextPreview)
@limiter.limit("3/minute;20/day", key_func=limit_key)
async def preview(request: Request, response: Response, payload: ContextAnswers,
                  user: User = Depends(assistant_user)) -> ContextPreview:
    response.headers["Cache-Control"] = "no-store"
    if user.id in _working_users:
        raise HTTPException(409, "Помощник уже готовит описание. Дождитесь результата.")
    _working_users.add(user.id)
    try:
        return await asyncio.wait_for(generate_context_preview(payload), timeout=40)
    except TimeoutError:
        raise HTTPException(504, "Нейросеть не успела ответить. Ответы остались в форме — попробуйте ещё раз.") from None
    except Exception as exc:
        logger.warning("Project context preview failed: %s", type(exc).__name__)
        raise HTTPException(502, "Не удалось составить описание. Попробуйте ещё раз или заполните поля вручную.") from None
    finally:
        _working_users.discard(user.id)

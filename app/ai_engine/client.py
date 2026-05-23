from openai import AsyncOpenAI

from app.core.config import settings


DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai"
DEEPINFRA_MODEL = "deepseek-ai/DeepSeek-V4-Flash"


def get_deepinfra_client() -> AsyncOpenAI:
    if not settings.deepinfra_api_key:
        raise RuntimeError("DEEPINFRA_API_KEY is not configured in .env")

    return AsyncOpenAI(
        api_key=settings.deepinfra_api_key,
        base_url=DEEPINFRA_BASE_URL,
    )


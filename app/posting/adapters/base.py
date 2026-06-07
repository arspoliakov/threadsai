from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.db.models import Account, PostingTask


@dataclass(slots=True)
class PublishResult:
    success: bool
    detected_username: str | None = None
    external_post_url: str | None = None


class BasePostingAdapter(ABC):
    @abstractmethod
    async def publish(
        self,
        account: Account,
        task: PostingTask,
        *,
        deadline_at: float | None = None,
        ip_guard_proxy_url: str | None = None,
        expected_proxy_ip: str | None = None,
    ) -> PublishResult:
        """Publish a posting task using the provided social account."""

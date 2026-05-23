from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.db.models import Account, PostingTask


@dataclass(slots=True)
class PublishResult:
    success: bool
    detected_username: str | None = None


class BasePostingAdapter(ABC):
    @abstractmethod
    async def publish(self, account: Account, task: PostingTask) -> PublishResult:
        """Publish a posting task using the provided social account."""

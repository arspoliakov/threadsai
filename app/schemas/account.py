from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import AccountStatus, Platform


class AccountCreate(BaseModel):
    project_id: int | None = None
    platform: Platform
    username: str = Field(min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    proxy_url: str | None = Field(default=None, max_length=1024)
    session_data_encrypted: str | None = None
    cookies_encrypted: str | None = None
    status: AccountStatus = AccountStatus.ACTIVE


class AccountUpdate(BaseModel):
    project_id: int | None = None
    platform: Platform | None = None
    username: str | None = Field(default=None, min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    proxy_url: str | None = Field(default=None, max_length=1024)
    session_data_encrypted: str | None = None
    cookies_encrypted: str | None = None
    status: AccountStatus | None = None
    last_error: str | None = None


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int | None
    project_id: int | None
    platform: Platform
    username: str
    display_name: str | None
    status: AccountStatus
    last_used_at: datetime | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime

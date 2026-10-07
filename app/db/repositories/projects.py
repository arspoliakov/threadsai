from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import GlobalPrompt, Project, PromptType, User
from app.schemas.project import ProjectCreate
from app.services.publication_mode import synchronize_mode


class ProjectRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_project(self, data: ProjectCreate, *, owner_id: int, onboarding_payload_hash: str | None = None) -> Project:
        values = synchronize_mode(data.model_dump(exclude={"global_style_body", "onboarding_request_key"}), explicitly_set=data.model_fields_set, creating=True)
        if data.global_style_body is not None:
            values["style_body"] = data.global_style_body.strip()
        elif data.style_body is None:
            templates = (await self.session.scalars(select(GlobalPrompt).where(
                GlobalPrompt.owner_id == owner_id, GlobalPrompt.prompt_type == PromptType.VIRALITY,
                GlobalPrompt.is_active.is_(True)).order_by(GlobalPrompt.id))).all()
            values["style_body"] = "\n\n".join(f"### {p.title}\nType: virality\n{p.body}" for p in templates)
        project = Project(**values, owner_id=owner_id)
        self.session.add(project)
        if data.onboarding_request_key is not None:
            await self.session.flush()
            owner = await self.session.get(User, owner_id)
            requests = dict((owner.onboarding_state or {}).get("creation_requests") or {})
            requests[data.onboarding_request_key] = {"project_id": project.id, "payload_hash": onboarding_payload_hash}
            owner.onboarding_state = {**(owner.onboarding_state or {}), "project_id": project.id,
                "creation_request_key": data.onboarding_request_key,
                "creation_payload_hash": onboarding_payload_hash, "creation_project_id": project.id,
                "creation_requests": requests}
        await self.session.commit()
        await self.session.refresh(project)
        return project

    async def get_project(self, project_id: int) -> Project | None:
        stmt = select(Project).where(Project.id == project_id)
        result = await self.session.scalars(stmt)
        return result.one_or_none()

    async def get_all_projects(self) -> list[Project]:
        stmt = select(Project).order_by(Project.created_at.desc())
        result = await self.session.scalars(stmt)
        return list(result.all())

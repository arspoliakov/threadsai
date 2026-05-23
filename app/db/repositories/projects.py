from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Project
from app.schemas.project import ProjectCreate


class ProjectRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_project(self, data: ProjectCreate) -> Project:
        project = Project(**data.model_dump())
        self.session.add(project)
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


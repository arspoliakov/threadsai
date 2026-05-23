from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import GlobalPrompt, Project, ProjectPrompt


async def build_system_prompt(project_id: int, session: AsyncSession) -> str:
    owner_id = await session.scalar(select(Project.owner_id).where(Project.id == project_id))
    global_prompts_stmt = (
        select(GlobalPrompt)
        .where(
            GlobalPrompt.is_active.is_(True),
            GlobalPrompt.owner_id == owner_id,
        )
        .order_by(GlobalPrompt.prompt_type, GlobalPrompt.id)
    )
    project_prompts_stmt = (
        select(ProjectPrompt)
        .where(
            ProjectPrompt.project_id == project_id,
            ProjectPrompt.is_active.is_(True),
        )
        .order_by(ProjectPrompt.priority.asc(), ProjectPrompt.prompt_type, ProjectPrompt.id)
    )

    global_prompts = list((await session.scalars(global_prompts_stmt)).all())
    project_prompts = list((await session.scalars(project_prompts_stmt)).all())

    sections: list[str] = [
        "You are the AI content engine for a multi-tenant automated posting system.",
        "Follow all global rules first, then adapt them to the project-specific context.",
    ]

    if global_prompts:
        sections.append("## Global Prompts")
        sections.extend(
            f"### {prompt.title}\nType: {prompt.prompt_type.value}\n{prompt.body}"
            for prompt in global_prompts
        )

    if project_prompts:
        sections.append("## Project-Specific Prompts")
        sections.extend(
            f"### {prompt.title}\nType: {prompt.prompt_type.value}\nPriority: {prompt.priority}\n{prompt.body}"
            for prompt in project_prompts
        )

    return "\n\n".join(sections)

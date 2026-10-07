"""Publication intent, including compatibility with the original boolean."""
from app.db.models import Project


def publication_mode(project: Project) -> str:
    if not project.auto_generate:
        return "manual"
    return project.publication_mode if project.publication_mode in {"review", "auto"} else "manual"


def synchronize_mode(data: dict, *, explicitly_set: set[str], creating: bool = False) -> dict:
    if "publication_mode" in explicitly_set and data.get("publication_mode") is not None:
        data["auto_generate"] = data["publication_mode"] != "manual"
    elif "auto_generate" in explicitly_set and data.get("auto_generate") is not None:
        data["publication_mode"] = "auto" if data["auto_generate"] else "manual"
    elif creating:
        data["publication_mode"] = "review"
        data["auto_generate"] = True
    return data

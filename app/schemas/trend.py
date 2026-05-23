from pydantic import BaseModel, Field


class TrendAIAnalysis(BaseModel):
    hook_mechanic: str = Field(min_length=1)
    structure_pattern: str = Field(min_length=1)
    tone_and_rhythm: str = Field(min_length=1)
    living_phrases: list[str] = Field(default_factory=list, max_length=8)
    semantic_forbidden_zone: list[str] = Field(default_factory=list, max_length=8)
    virality_score: int = Field(ge=1, le=10)

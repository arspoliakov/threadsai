import { apiClient } from "./client";

export type ProjectContextAnswers = { offer: string; audience: string; problems: string };
export type ProjectContextPreview = { description: string; target_audience: string; product_context: string };

export async function assistProjectContext(answers: ProjectContextAnswers): Promise<ProjectContextPreview> {
  const response = await apiClient.post<ProjectContextPreview>("/api/v1/project-context/preview", answers, { timeout: 45000 });
  return response.data;
}

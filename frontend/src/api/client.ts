import axios from "axios";
import { toast } from "sonner";

export const AUTH_TOKEN_STORAGE_KEY = "threadsbot.admin_token";
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

export function getStoredAuthToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export function setStoredAuthToken(token: string) {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
}

export function clearStoredAuthToken() {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

apiClient.interceptors.request.use((config) => {
  const token = getStoredAuthToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    delete config.headers.Authorization;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearStoredAuthToken();
      window.localStorage.removeItem("threadsbot.authenticated");

      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }

    if (error?.response?.status === 403) {
      const detail = error?.response?.data?.detail;
      const isAccessDenied =
        detail === "Telegram user is not approved for dashboard access" ||
        detail === "Invalid admin token" ||
        detail === "Tenant-scoped API requires Telegram JWT authentication.";

      if (isAccessDenied) {
        clearStoredAuthToken();
        window.localStorage.removeItem("threadsbot.authenticated");

        if (window.location.pathname !== "/login") {
          window.location.assign("/login?reason=access-denied");
        }
      }
    }

    if (error?.response?.status === 402) {
      const detail = error?.response?.data?.detail;
      const code = typeof detail === "object" && detail ? detail.code : "";

      if (code === "subscription_required" && window.location.pathname !== "/app/billing") {
        window.location.assign("/app/billing");
      }
    }

    if (error?.response?.status >= 500) {
      const detail = error?.response?.data?.detail;
      const errorId = error?.response?.data?.error_id;
      const message =
        typeof detail === "string"
          ? detail
          : "Произошла ошибка на сервере. Лог уже отправлен админу, мы разбираемся.";

      toast.error(errorId ? `${message} Код: ${errorId}` : message, {
        id: errorId ? `api-error-${errorId}` : "api-error-reported",
        duration: 7000,
      });
    }

    return Promise.reject(error);
  },
);

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) {
    return fallback;
  }

  const detail = error.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (detail && typeof detail === "object") {
    const code = typeof detail.code === "string" ? detail.code : "";
    const limit = typeof detail.limit === "number" ? detail.limit : null;

    if (code === "subscription_required") {
      return "Для этого действия нужна активная подписка.";
    }
    if (code === "tariff_projects_limit_reached") {
      return limit === null
        ? "Достигнут лимит проектов текущего тарифа."
        : `На текущем тарифе доступно проектов: ${limit}.`;
    }
    if (code === "tariff_accounts_limit_reached") {
      return limit === null
        ? "Достигнут лимит профилей текущего тарифа."
        : `На текущем тарифе доступно профилей: ${limit}.`;
    }
    if (code === "tariff_posts_limit_reached") {
      return limit === null
        ? "Достигнут дневной лимит публикаций текущего тарифа."
        : `На текущем тарифе доступно публикаций в день: ${limit}.`;
    }
    if (typeof detail.message === "string" && detail.message.trim()) {
      return detail.message;
    }
  }

  return fallback;
}

export type LoginResponse = {
  access_token: string;
  token_type: "bearer";
};

export type CurrentUser = {
  id: number;
  telegram_id: number | null;
  username: string | null;
  first_name: string;
  photo_url: string | null;
  subscription_status: boolean;
  tariff_plan: string;
  tariff_accounts_limit: number;
  tariff_posts_per_day: number;
  tariff_projects_limit: number;
  tariff_queue_days: number;
};

export type BillingPlan = {
  name: string;
  accounts: number;
  posts: number;
  projects: number;
  queue_days: number;
  tribute_url: string;
};

export type BillingStatus = {
  subscription_status: boolean;
  tariff_plan: string;
  accounts_limit: number;
  posts_per_day_limit: number;
  projects_limit: number;
  queue_days: number;
  plans: BillingPlan[];
};

export type TelegramAuthPayload = {
  id: number;
  first_name: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginError";
  }
}

export type Project = {
  id: number;
  owner_id: number | null;
  name: string;
  slug: string;
  description: string | null;
  global_context: string | null;
  target_actions: string[];
  niche: string | null;
  target_audience: string | null;
  tone_of_voice: string | null;
  product_context: string | null;
  conversion_mode: ConversionMode;
  conversion_target: string | null;
  conversion_intensity: number;
  stop_words: string[];
  posts_per_day: number;
  active_hours_start: string;
  active_hours_end: string;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ConversionMode = "bio_link" | "pinned_post" | "none";

export type ProjectCreatePayload = {
  name: string;
  slug: string;
  description?: string | null;
  global_context?: string | null;
  target_actions?: string[];
  conversion_mode?: ConversionMode;
  conversion_target?: string | null;
  conversion_intensity?: number;
  stop_words?: string[];
  is_active?: boolean;
};

export type ProjectUpdatePayload = Partial<ProjectCreatePayload> & {
  niche?: string | null;
  target_audience?: string | null;
  tone_of_voice?: string | null;
  product_context?: string | null;
  stop_words?: string[];
  posts_per_day?: number;
  active_hours_start?: string;
  active_hours_end?: string;
  timezone?: string;
};

export type ProjectDashboard = {
  project: Project;
  accounts_count: number;
  saved_trends_count: number;
  posting_tasks_by_status: Record<string, number>;
  recent_errors: string[];
  account_states: ProjectAccountState[];
  last_generation_at: string | null;
};

export type DashboardProjectSummary = {
  id: number;
  name: string;
  published_count: number;
  next_post_time: string | null;
  avg_engagement: number | null;
};

export type DashboardSummary = {
  next_trend_check: string | null;
  projects: DashboardProjectSummary[];
};

export type ProjectAccountState = {
  id: number;
  username: string;
  platform: Platform;
  status: AccountStatus;
  last_error: string | null;
  last_used_at: string | null;
};

export type Platform = "threads";
export type AccountStatus =
  | "active"
  | "disabled"
  | "error"
  | "warming_up"
  | "cookies_expired"
  | "blocked"
  | "proxy_error";

export type Account = {
  id: number;
  owner_id: number | null;
  project_id: number | null;
  platform: Platform;
  username: string;
  display_name: string | null;
  status: AccountStatus;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountCreatePayload = {
  project_id?: number | null;
  platform: Platform;
  username: string;
  display_name?: string | null;
  session_data_encrypted?: string | null;
  cookies_encrypted?: string | null;
  status?: AccountStatus;
};

export type AccountUpdatePayload = Partial<AccountCreatePayload> & {
  last_error?: string | null;
};

export type AccountSessionCheckResult = {
  account_id: number;
  status: AccountStatus;
  message: string;
  detected_username: string | null;
};

export type PostingTaskStatus =
  | "draft"
  | "queued"
  | "running"
  | "success"
  | "partial_success"
  | "failed"
  | "cancelled";

export type PostingTask = {
  id: number;
  project_id: number;
  account_id: number | null;
  account_username: string | null;
  source_trend_id: number | null;
  platform: Platform;
  content_text: string;
  posts_chain: string[];
  media_url: string | null;
  status: PostingTaskStatus;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  retry_count: number;
  error_message: string | null;
  external_post_url: string | null;
  generation_metadata: GenerationMetadata | null;
  created_at: string;
  updated_at: string;
};

export type GenerationMetadata = {
  applied_angle?: string;
  hook_mechanic?: string;
  structure_pattern?: string;
  tone_and_rhythm?: string;
  trends_used_count?: number;
  publication_memory_used_count?: number;
};

export type SavedTrend = {
  id: number;
  project_id: number;
  platform: Platform;
  source_url: string;
  author_handle: string | null;
  raw_text: string;
  metrics_json: Record<string, unknown> | null;
  ai_summary: string | null;
  virality_score: number | null;
  hook_analysis: string | null;
  hook_mechanic: string | null;
  structure_pattern: string | null;
  tone_and_rhythm: string | null;
  living_phrases: string[];
  semantic_forbidden_zone: string[];
  adaptation_notes: string | null;
  parsed_at: string | null;
  analyzed: boolean;
  created_at: string;
  updated_at: string;
};

export type TriggerScrapingResult = {
  project_id: number;
  operation_id: number;
  status: ProjectOperationStatus;
  message: string | null;
};

export type ProjectOperationType = "scraping" | "generation";
export type ProjectOperationStatus = "queued" | "running" | "success" | "failed";

export type ProjectOperation = {
  id: number;
  project_id: number;
  action_type: ProjectOperationType;
  status: ProjectOperationStatus;
  message: string | null;
  result_json: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
};

export type TriggerGenerationResult = {
  project_id: number;
  task_id: number;
  status: PostingTaskStatus;
  scheduled_at: string | null;
  content_text: string;
  posts_chain: string[];
};

export type PromptType =
  | "virality"
  | "hook"
  | "formatting"
  | "retention"
  | "project_context"
  | "tone_of_voice";

export type GlobalPrompt = {
  id: number;
  owner_id: number | null;
  prompt_type: PromptType;
  title: string;
  body: string;
  version: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type GlobalPromptCreatePayload = {
  prompt_type: PromptType;
  title: string;
  body: string;
  version?: string;
  is_active?: boolean;
};

export type GlobalPromptUpdatePayload = Partial<GlobalPromptCreatePayload>;

export async function login(password: string): Promise<LoginResponse> {
  try {
    const response = await axios.post<LoginResponse>(
      `${API_BASE_URL}/api/v1/auth/login`,
      { password },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        throw new LoginError("Неверный пароль.");
      }

      if (error.response?.status === 429) {
        throw new LoginError("Слишком много попыток входа. Подождите минуту и попробуйте снова.");
      }

      if (error.response?.status === 403) {
        throw new LoginError("Доступ пока не открыт. Напишите владельцу сервиса, чтобы он добавил ваш Telegram ID в список допуска.");
      }

      if (!error.response) {
        throw new LoginError("API недоступен. Проверьте, что backend запущен на 127.0.0.1:8000.");
      }
    }

    throw new LoginError("Не удалось выполнить вход. Попробуйте еще раз.");
  }
}

export async function loginWithTelegram(payload: TelegramAuthPayload): Promise<LoginResponse> {
  try {
    const response = await axios.post<LoginResponse>(
      `${API_BASE_URL}/api/v1/auth/telegram`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        throw new LoginError("Telegram не подтвердил подлинность входа.");
      }

      if (error.response?.status === 429) {
        throw new LoginError("Слишком много попыток входа. Подождите минуту и попробуйте снова.");
      }

      if (!error.response) {
        throw new LoginError("API недоступен. Проверьте, что backend запущен на 127.0.0.1:8000.");
      }
    }

    throw new LoginError("Не удалось выполнить вход через Telegram. Попробуйте еще раз.");
  }
}

export async function loginWithTelegramWebApp(initData: string): Promise<LoginResponse> {
  try {
    const response = await axios.post<LoginResponse>(
      `${API_BASE_URL}/api/v1/auth/telegram-webapp`,
      { init_data: initData },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        throw new LoginError("Telegram не подтвердил вход внутри приложения.");
      }

      if (error.response?.status === 403) {
        throw new LoginError("Доступ пока не открыт. Напишите владельцу сервиса, чтобы он добавил ваш Telegram ID.");
      }

      if (error.response?.status === 429) {
        throw new LoginError("Слишком много попыток входа. Подождите минуту и попробуйте снова.");
      }

      if (!error.response) {
        throw new LoginError("API недоступен. Проверьте соединение и попробуйте еще раз.");
      }
    }

    throw new LoginError("Не удалось выполнить вход через Telegram. Попробуйте еще раз.");
  }
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const response = await apiClient.get<CurrentUser>("/api/v1/auth/me");
  return response.data;
}

export async function getBillingStatus(): Promise<BillingStatus> {
  const response = await apiClient.get<BillingStatus>("/api/v1/billing/status");
  return response.data;
}

export async function getProjects(): Promise<Project[]> {
  const response = await apiClient.get<Project[]>("/api/v1/projects/");
  return response.data;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const response = await apiClient.get<DashboardSummary>("/api/v1/dashboard/summary");
  return response.data;
}

export async function createProject(data: ProjectCreatePayload): Promise<Project> {
  const response = await apiClient.post<Project>("/api/v1/projects/", data);
  return response.data;
}

export async function updateProject(id: number, data: ProjectUpdatePayload): Promise<Project> {
  const response = await apiClient.put<Project>(`/api/v1/projects/${id}`, data);
  return response.data;
}

export async function deleteProject(id: number): Promise<void> {
  await apiClient.delete(`/api/v1/projects/${id}`);
}

export async function getProjectDashboard(id: number): Promise<ProjectDashboard> {
  const response = await apiClient.get<ProjectDashboard>(`/api/v1/projects/${id}/dashboard`);
  return response.data;
}

export async function getActiveGlobalPrompts(): Promise<GlobalPrompt[]> {
  const response = await apiClient.get<GlobalPrompt[]>("/api/v1/prompts/global/active");
  return response.data;
}

export async function createGlobalPrompt(data: GlobalPromptCreatePayload): Promise<GlobalPrompt> {
  const response = await apiClient.post<GlobalPrompt>("/api/v1/prompts/global", data);
  return response.data;
}

export async function updateGlobalPrompt(
  id: number,
  data: GlobalPromptUpdatePayload,
): Promise<GlobalPrompt> {
  const response = await apiClient.patch<GlobalPrompt>(`/api/v1/prompts/global/${id}`, data);
  return response.data;
}

export async function triggerScraping(projectId: number): Promise<TriggerScrapingResult> {
  const response = await apiClient.post<TriggerScrapingResult>(
    `/api/v1/projects/${projectId}/trigger-scraping`,
  );
  return response.data;
}

export async function getLatestProjectOperation(
  projectId: number,
  actionType: ProjectOperationType,
): Promise<ProjectOperation | null> {
  const response = await apiClient.get<ProjectOperation | null>(
    `/api/v1/projects/${projectId}/operations/latest`,
    { params: { action_type: actionType } },
  );
  return response.data;
}

export async function getProjectOperations(projectId: number, limit = 10): Promise<ProjectOperation[]> {
  const response = await apiClient.get<ProjectOperation[]>(`/api/v1/projects/${projectId}/operations`, {
    params: { limit },
  });
  return response.data;
}

export async function triggerGeneration(projectId: number): Promise<TriggerGenerationResult> {
  const response = await apiClient.post<TriggerGenerationResult>(
    `/api/v1/projects/${projectId}/trigger-generation`,
  );
  return response.data;
}

export async function getAccounts(): Promise<Account[]> {
  const response = await apiClient.get<Account[]>("/api/v1/accounts/");
  return response.data;
}

export async function createAccount(data: AccountCreatePayload): Promise<Account> {
  const response = await apiClient.post<Account>("/api/v1/accounts/", data);
  return response.data;
}

export async function updateAccount(id: number, data: AccountUpdatePayload): Promise<Account> {
  const response = await apiClient.patch<Account>(`/api/v1/accounts/${id}`, data);
  return response.data;
}

export async function unlinkAccount(id: number): Promise<Account> {
  const response = await apiClient.post<Account>(`/api/v1/accounts/${id}/unlink`);
  return response.data;
}

export async function checkAccountSession(id: number): Promise<AccountSessionCheckResult> {
  const response = await apiClient.post<AccountSessionCheckResult>(`/api/v1/accounts/${id}/check-session`);
  return response.data;
}

export async function deleteAccount(id: number): Promise<void> {
  await apiClient.delete(`/api/v1/accounts/${id}`);
}

export async function getProjectTrends(projectId: number): Promise<SavedTrend[]> {
  const response = await apiClient.get<SavedTrend[]>("/api/v1/trends/", {
    params: { project_id: projectId },
  });
  return response.data;
}

export async function getProjectTasks(projectId: number): Promise<PostingTask[]> {
  const response = await apiClient.get<PostingTask[]>("/api/v1/tasks/", {
    params: { project_id: projectId },
  });
  return response.data;
}

export async function updateTask(taskId: number, contentText: string): Promise<PostingTask> {
  const response = await apiClient.put<PostingTask>(`/api/v1/tasks/${taskId}`, {
    content_text: contentText,
  });
  return response.data;
}

export async function regenerateTask(taskId: number): Promise<PostingTask> {
  const response = await apiClient.post<PostingTask>(`/api/v1/tasks/${taskId}/regenerate`);
  return response.data;
}

export async function cancelTask(taskId: number): Promise<PostingTask> {
  const response = await apiClient.patch<PostingTask>(`/api/v1/tasks/${taskId}/cancel`);
  return response.data;
}

export async function publishTaskNow(taskId: number): Promise<{ task_id: number; status: string }> {
  const response = await apiClient.post<{ task_id: number; status: string }>(
    `/api/v1/tasks/${taskId}/publish-now`,
  );
  return response.data;
}

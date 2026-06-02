import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  checkAccountSession,
  createAccount,
  deleteAccount,
  getAccounts,
  unlinkAccount,
  type Account,
  type AccountStatus,
  type Platform,
} from "../../api/client";

const THREADS_PLATFORM: Platform = "threads";
const SESSION_USERNAME_PLACEHOLDER = "pending_from_session";

type AuthMode = "password" | "cookies";

export default function InfrastructurePage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function loadAccounts() {
    setIsLoading(true);

    try {
      setAccounts(await getAccounts());
    } catch {
      toast.error("Не удалось загрузить аккаунты");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAccounts();
  }, []);

  async function handleCheckSession(accountId: number) {
    setCheckingId(accountId);

    try {
      const promise = checkAccountSession(accountId);
      toast.promise(promise, {
        loading: "Проверяем cookies-сессию...",
        success: (result) => result.message,
        error: "Не удалось проверить сессию",
      });
      await promise;
      await loadAccounts();
    } finally {
      setCheckingId(null);
    }
  }

  async function handleUnlink(accountId: number) {
    setUnlinkingId(accountId);

    try {
      await toast.promise(unlinkAccount(accountId), {
        loading: "Отвязываем аккаунт от проекта...",
        success: "Аккаунт вернулся в общий пул",
        error: "Не удалось отвязать аккаунт",
      });
      await loadAccounts();
    } finally {
      setUnlinkingId(null);
    }
  }

  async function handleDelete(accountId: number) {
    const confirmed = window.confirm("Удалить аккаунт из пула? Cookies и настройки аккаунта будут удалены.");
    if (!confirmed) {
      return;
    }

    setDeletingId(accountId);

    try {
      await toast.promise(deleteAccount(accountId), {
        loading: "Удаляем аккаунт...",
        success: "Аккаунт удален",
        error: "Не удалось удалить аккаунт",
      });
      await loadAccounts();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="space-y-8">
      <header className="grid gap-6 border-b border-[#c9c9c3] pb-8 md:grid-cols-[1fr_auto]">
        <div>
          <h1 className="font-display text-5xl leading-none">Аккаунты</h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-[#66645d]">
            Здесь хранится общий пул Threads-профилей. Аккаунт можно держать свободным,
            привязать к проекту, проверить cookies-сессию или удалить из системы.
          </p>
        </div>
        <div className="grid gap-3 self-end sm:flex">
          <button
            type="button"
            onClick={() => setIsBulkOpen(true)}
            className="h-11 rounded-2xl border border-[#151515] px-5 font-mono text-xs uppercase tracking-[0.16em] text-[#151515] transition hover:bg-[#151515] hover:text-white"
          >
            Массовый импорт
          </button>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="h-11 rounded-2xl border border-[#151515] bg-[#151515] px-5 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515]"
          >
            Добавить аккаунт
          </button>
        </div>
      </header>

      <section className="grid overflow-hidden rounded-[2rem] border border-[#dfe4dc] bg-[#07100e] text-white shadow-sm lg:grid-cols-[0.95fr_1.05fr]">
        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/12 bg-white/8">
              <img src="/threadsgo-logo.png" alt="" className="h-8 w-8 object-contain" />
            </span>
            <div>
              <p className="text-sm font-medium">Пул профилей</p>
              <p className="mt-1 text-xs text-white/45">cookies и здоровье сессий</p>
            </div>
          </div>
          <h2 className="mt-8 max-w-xl font-display text-4xl leading-none tracking-[-0.04em] sm:text-5xl">
            Аккаунты
          </h2>
          <p className="mt-5 max-w-xl text-sm leading-7 text-white/58">
            Каждый Threads-профиль живет отдельно: свой статус cookies и своя привязка к проекту.
            Если сессия слетит, система остановит публикации и покажет проблему здесь.
          </p>
        </div>
        <div className="relative min-h-64 overflow-hidden lg:min-h-full">
          <img src="/interface/accounts-health.webp" alt="" className="h-full w-full object-cover opacity-88" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#07100e] via-[#07100e]/10 to-transparent lg:bg-gradient-to-l" />
        </div>
      </section>

      <section className="rounded-3xl border border-[#deded7] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e7e5de] pb-5">
          <div>
            <h2 className="font-display text-3xl">Пул аккаунтов</h2>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {isLoading ? (
            <AccountSkeleton />
          ) : accounts.length === 0 ? (
            <EmptyState
              title="Пока нет аккаунтов"
              description="Добавьте Threads-профиль через cookies. После проверки система сама определит username."
            />
          ) : (
            accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                checking={checkingId === account.id}
                unlinking={unlinkingId === account.id}
                deleting={deletingId === account.id}
                onCheck={() => void handleCheckSession(account.id)}
                onUnlink={() => void handleUnlink(account.id)}
                onDelete={() => void handleDelete(account.id)}
              />
            ))
          )}
        </div>
      </section>

      {isCreateOpen ? (
        <CreateAccountPanel
          onClose={() => setIsCreateOpen(false)}
          onCreated={async () => {
            setIsCreateOpen(false);
            await loadAccounts();
          }}
        />
      ) : null}

      {isBulkOpen ? (
        <BulkImportPanel
          onClose={() => setIsBulkOpen(false)}
          onImported={async () => {
            setIsBulkOpen(false);
            await loadAccounts();
          }}
        />
      ) : null}
    </section>
  );
}

function AccountCard({
  account,
  checking,
  unlinking,
  deleting,
  onCheck,
  onUnlink,
  onDelete,
}: {
  account: Account;
  checking: boolean;
  unlinking: boolean;
  deleting: boolean;
  onCheck: () => void;
  onUnlink: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4 transition hover:border-[#151515] hover:shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-center">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">Профиль</p>
          <p className="mt-1 text-sm text-[#24231f]">{formatUsername(account.username)}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">Статус</p>
          <StatusBadge status={account.status} />
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">Проект</p>
          <p className="mt-1 text-sm text-[#24231f]">
            {account.project_id === null ? "Свободен" : `Привязан к проекту #${account.project_id}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={onCheck} disabled={checking || unlinking || deleting}>
            {checking ? "проверка..." : "проверить cookies"}
          </ActionButton>
          {account.project_id !== null ? (
            <ActionButton onClick={onUnlink} disabled={checking || unlinking || deleting}>
              {unlinking ? "отвязка..." : "отвязать"}
            </ActionButton>
          ) : null}
          <ActionButton danger onClick={onDelete} disabled={checking || unlinking || deleting}>
            {deleting ? "удаление..." : "удалить"}
          </ActionButton>
        </div>
      </div>

      {account.last_error ? (
        <p className="mt-4 rounded-2xl border border-[#f0c7c1] bg-[#fff6f4] px-4 py-3 text-xs leading-5 text-[#8a2d25]">
          {account.last_error}
        </p>
      ) : null}
    </article>
  );
}

function CreateAccountPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("cookies");
  const [cookiesInput, setCookiesInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const cookiesPayload = authMode === "cookies" ? normalizeCookies(cookiesInput) : null;

      await createAccount({
        project_id: null,
        platform: THREADS_PLATFORM,
        username: SESSION_USERNAME_PLACEHOLDER,
        session_data_encrypted: JSON.stringify({
          auth_method: authMode,
          username_source: "session",
          password: authMode === "password" ? password : undefined,
        }),
        cookies_encrypted: cookiesPayload,
        status: "active",
      });
      toast.success("Аккаунт добавлен");
      await onCreated();
    } catch (submitError) {
      toast.error("Аккаунт не создан");
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Проверьте формат cookies и доступность API.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45">
      <aside className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-black bg-[#f6f6f2]">
        <header className="flex items-center justify-between border-b border-[#c9c9c3] px-7 py-6">
          <div>
            <h2 className="font-display text-3xl">Добавить аккаунт</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-[#151515] px-3 py-2 font-mono text-xs uppercase transition hover:bg-[#151515] hover:text-white"
          >
            Закрыть
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto px-7 py-8">
          <label className="grid gap-2">
            <span className="field-label">Платформа</span>
            <select value={THREADS_PLATFORM} disabled className="field-control opacity-70">
              <option value="threads">Threads</option>
            </select>
          </label>

          <div className="mt-8 rounded-2xl border border-[#e1e1dc] bg-white px-4 py-3 text-xs leading-5 text-[#66645d]">
            Username вводить не нужно. После проверки cookies система сама определит профиль Threads.
          </div>

          <div className="mt-8">
            <span className="field-label">Способ входа</span>
            <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-2xl border border-[#151515]">
              <AuthTab label="По паролю" isActive={authMode === "password"} onClick={() => setAuthMode("password")} />
              <AuthTab label="По cookies" isActive={authMode === "cookies"} onClick={() => setAuthMode("cookies")} />
            </div>
          </div>

          {authMode === "password" ? (
            <Field label="Пароль" value={password} onChange={setPassword} type="password" required />
          ) : (
            <label className="mt-8 grid gap-2">
              <span className="field-label">Cookies JSON или cookie-строка</span>
              <textarea
                value={cookiesInput}
                onChange={(event) => setCookiesInput(event.target.value)}
                required
                rows={8}
                placeholder='[{"name":"sessionid","value":"...","domain":".threads.net"}]'
                className="field-control resize-none leading-6"
              />
              <div className="rounded-2xl border border-[#e1e1dc] bg-white px-4 py-3 text-xs leading-5 text-[#66645d]">
                Как получить cookies: установите Cookie-Editor, зайдите на threads.net под нужным аккаунтом,
                нажмите Export JSON и вставьте результат сюда. Это безопаснее, чем хранить пароль.
              </div>
            </label>
          )}

          {error ? (
            <div className="mt-6 border-l-2 border-[#b42318] px-4 py-3 text-sm text-[#61140e]">
              {error}
            </div>
          ) : null}

          <div className="mt-auto border-t border-[#d4d4ce] pt-6">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-2xl border border-[#151515] bg-[#151515] px-5 py-4 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? "Создание..." : "Добавить аккаунт"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function BulkImportPanel({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> }) {
  const [rawInput, setRawInput] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  async function handleBulkImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    let items: BulkAccountDraft[];
    try {
      items = parseBulkAccounts(rawInput);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : "Не удалось разобрать список аккаунтов.";
      setError(message);
      toast.error(message);
      return;
    }

    if (items.length === 0) {
      toast.error("Вставьте хотя бы один аккаунт для импорта");
      return;
    }

    setIsImporting(true);
    setProgress({ done: 0, total: items.length });

    let created = 0;
    const failed: string[] = [];

    for (const [index, item] of items.entries()) {
      try {
        await createAccount({
          project_id: null,
          platform: THREADS_PLATFORM,
          username: SESSION_USERNAME_PLACEHOLDER,
          session_data_encrypted: JSON.stringify({
            auth_method: "cookies",
            username_source: "session",
          }),
          cookies_encrypted: item.cookiesPayload,
          status: "active",
        });
        created += 1;
      } catch (importError) {
        failed.push(`#${index + 1}: ${importError instanceof Error ? importError.message : "ошибка API"}`);
      } finally {
        setProgress({ done: index + 1, total: items.length });
      }
    }

    setIsImporting(false);

    if (failed.length > 0) {
      setError(`Создано ${created} из ${items.length}. Ошибки: ${failed.slice(0, 3).join("; ")}`);
      toast.error(`Импорт частично завершен: ${created}/${items.length}`);
      await onImported();
      return;
    }

    toast.success(`Импортировано аккаунтов: ${created}`);
    await onImported();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45">
      <aside className="ml-auto flex h-full w-full max-w-2xl flex-col border-l border-black bg-[#f6f6f2]">
        <header className="flex items-center justify-between border-b border-[#c9c9c3] px-7 py-6">
          <div>
            <h2 className="font-display text-3xl">Массовый импорт аккаунтов</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            className="rounded-2xl border border-[#151515] px-3 py-2 font-mono text-xs uppercase transition hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Закрыть
          </button>
        </header>

        <form onSubmit={handleBulkImport} className="flex flex-1 flex-col overflow-y-auto px-7 py-8">
          <div className="rounded-2xl border border-[#e1e1dc] bg-white px-4 py-3 text-xs leading-5 text-[#66645d]">
            Безопасный формат для пачки: JSON-массив объектов вида
            <code className="mx-1 rounded bg-[#f1f1eb] px-1">{"[{\"cookies\": [...]}]"}</code>.
            Можно также вставлять несколько cookie-экспортов через строку-разделитель <code className="rounded bg-[#f1f1eb] px-1">---</code>.
            Автопроверку cookies после импорта не запускаем, чтобы не открыть десятки браузеров сразу.
          </div>

          <label className="mt-6 grid gap-2">
            <span className="field-label">Список cookies</span>
            <textarea
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              disabled={isImporting}
              rows={16}
              placeholder={`[
  {"cookies": [{"name": "sessionid", "value": "...", "domain": ".threads.net"}]},
  {"cookies": [{"name": "sessionid", "value": "...", "domain": ".threads.net"}]}
]`}
              className="field-control resize-y font-mono text-xs leading-5"
            />
          </label>

          {progress.total > 0 ? (
            <div className="mt-5 rounded-2xl border border-[#e1e1dc] bg-white p-4">
              <div className="flex items-center justify-between text-xs text-[#66645d]">
                <span>Прогресс импорта</span>
                <span>
                  {progress.done}/{progress.total}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e9e9e2]">
                <div
                  className="h-full rounded-full bg-[#151515] transition-all"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 rounded-2xl border border-[#f0c7c1] bg-[#fff6f4] px-4 py-3 text-sm leading-6 text-[#8a2d25]">
              {error}
            </div>
          ) : null}

          <div className="mt-auto border-t border-[#d4d4ce] pt-6">
            <button
              type="submit"
              disabled={isImporting}
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-[#151515] bg-[#151515] px-5 py-4 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isImporting ? <Spinner /> : null}
              {isImporting ? "Импортируем..." : "Импортировать аккаунты"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function AuthTab({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        isActive
          ? "bg-[#151515] px-4 py-3 font-mono text-xs uppercase tracking-[0.14em] text-white"
          : "bg-transparent px-4 py-3 font-mono text-xs uppercase tracking-[0.14em] text-[#151515] transition hover:bg-[#e8e8e2]"
      }
    >
      {label}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="mt-8 grid gap-2">
      <span className="field-label">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        required={required}
        className="field-control"
      />
    </label>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  danger = false,
}: {
  children: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        danger
          ? "rounded-2xl border border-[#b42318] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a2d25] transition hover:bg-[#b42318] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          : "rounded-2xl border border-[#151515] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] transition hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: AccountStatus }) {
  const label = statusLabels[status] ?? status;
  const tone = status === "active" ? "bg-[#edf8e8] text-[#25551f]" : status === "cookies_expired" || status === "blocked" || status === "proxy_error" ? "bg-[#fff4df] text-[#8a4b00]" : "bg-[#f7e8e5] text-[#8a2d25]";
  return (
    <span className={`mt-1 inline-flex rounded-full px-3 py-1 text-xs ${tone}`}>
      {label}
    </span>
  );
}

const statusLabels: Record<AccountStatus, string> = {
  active: "активен",
  disabled: "выключен",
  error: "ошибка",
  warming_up: "прогрев",
  cookies_expired: "cookies истекли",
  blocked: "заблокирован",
  proxy_error: "техническая пауза",
};

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-[#c9c9c3] bg-white/70 px-6 py-12 text-center shadow-sm">
      <p className="font-display text-3xl leading-none text-[#151515]">{title}</p>
      <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-[#66645d]">{description}</p>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="grid gap-3">
      {[1, 2, 3].map((item) => (
        <div key={item} className="h-20 animate-pulse rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] p-4">
          <div className="h-3 w-1/2 rounded-full bg-[#deded7]" />
        </div>
      ))}
    </div>
  );
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />;
}

function normalizeCookies(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error("Вставьте JSON-массив cookies или cookie-строку.");
  }

  try {
    const parsedCookies = JSON.parse(trimmedValue);
    return JSON.stringify(parsedCookies);
  } catch {
    return JSON.stringify(trimmedValue);
  }
}

type BulkAccountDraft = {
  cookiesPayload: string;
};

function parseBulkAccounts(value: string): BulkAccountDraft[] {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmedValue);

    if (Array.isArray(parsed) && isCookieList(parsed)) {
      return [{ cookiesPayload: JSON.stringify(parsed) }];
    }

    if (Array.isArray(parsed)) {
      return parsed.map((item, index) => normalizeBulkItem(item, index));
    }

    return [normalizeBulkItem(parsed, 0)];
  } catch {
    return trimmedValue
      .split(/\n\s*---\s*\n/g)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block, index) => {
        try {
          const parsedBlock = JSON.parse(block);
          return Array.isArray(parsedBlock) && isCookieList(parsedBlock)
            ? { cookiesPayload: JSON.stringify(parsedBlock) }
            : normalizeBulkItem(parsedBlock, index);
        } catch {
          return { cookiesPayload: JSON.stringify(block) };
        }
      });
  }
}

function normalizeBulkItem(item: unknown, index: number): BulkAccountDraft {
  if (typeof item === "string") {
    return { cookiesPayload: normalizeCookies(item) };
  }

  if (!item || typeof item !== "object") {
    throw new Error(`Аккаунт #${index + 1}: ожидается объект, JSON cookies или cookie-строка.`);
  }

  const record = item as Record<string, unknown>;
  const cookies = record.cookies ?? record.cookies_encrypted ?? record.cookie;

  if (typeof cookies === "string") {
    return {
      cookiesPayload: normalizeCookies(cookies),
    };
  }

  if (Array.isArray(cookies)) {
    return {
      cookiesPayload: JSON.stringify(cookies),
    };
  }

  throw new Error(`Аккаунт #${index + 1}: не найдено поле cookies.`);
}

function isCookieList(value: unknown[]): boolean {
  return value.every(
    (item) =>
      item &&
      typeof item === "object" &&
      "name" in item &&
      ("value" in item || "expirationDate" in item),
  );
}

function formatUsername(username: string) {
  return username === SESSION_USERNAME_PLACEHOLDER ? "Из сессии" : `@${username.replace(/^@/, "")}`;
}

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
const PROXY_POOL_STORAGE_KEY = "threadsbot.proxyPool";
const SESSION_USERNAME_PLACEHOLDER = "pending_from_session";

type AuthMode = "password" | "cookies";

export default function InfrastructurePage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [proxyPool, setProxyPool] = useState<string[]>(() => loadProxyPool());
  const [newProxyUrl, setNewProxyUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
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

  function handleAddProxy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedProxy = newProxyUrl.trim();
    if (!normalizedProxy) {
      return;
    }

    if (proxyPool.includes(normalizedProxy)) {
      toast.error("Такой прокси уже есть в пуле");
      setNewProxyUrl("");
      return;
    }

    const nextProxyPool = [...proxyPool, normalizedProxy];
    setProxyPool(nextProxyPool);
    saveProxyPool(nextProxyPool);
    setNewProxyUrl("");
    toast.success("Прокси добавлен");
  }

  function removeProxy(proxyUrl: string) {
    const nextProxyPool = proxyPool.filter((item) => item !== proxyUrl);
    setProxyPool(nextProxyPool);
    saveProxyPool(nextProxyPool);
    toast.success("Прокси удален из локального пула");
  }

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
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#77766f]">
            Аккаунты и прокси
          </p>
          <h1 className="mt-4 font-display text-5xl leading-none">Аккаунты</h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-[#66645d]">
            Здесь хранится общий пул Threads-профилей. Аккаунт можно держать свободным,
            привязать к проекту, проверить cookies-сессию или удалить из системы.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="h-11 self-end rounded-2xl border border-[#151515] bg-[#151515] px-5 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515]"
        >
          Добавить аккаунт
        </button>
      </header>

      <section className="rounded-3xl border border-[#deded7] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e7e5de] pb-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">
              Threads profiles
            </p>
            <h2 className="mt-2 font-display text-3xl">Пул аккаунтов</h2>
          </div>
          <button
            type="button"
            onClick={() => void loadAccounts()}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-2xl border border-[#151515] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] transition hover:bg-[#151515] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <Spinner /> : null}
            Обновить
          </button>
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

      <section className="rounded-3xl border border-[#deded7] bg-white p-6 shadow-sm">
        <div className="border-b border-[#e7e5de] pb-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">
            Proxy pool
          </p>
          <h2 className="mt-2 font-display text-3xl">Прокси</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66645d]">
            Это локальный список для формы добавления аккаунта. Сам прокси сохраняется внутри аккаунта.
          </p>
        </div>

        <form onSubmit={handleAddProxy} className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            value={newProxyUrl}
            onChange={(event) => setNewProxyUrl(event.target.value)}
            placeholder="http://user:pass@ip:port"
            className="rounded-2xl border border-[#d8d8d2] bg-[#fbfaf5] px-4 py-3 text-sm outline-none transition focus:border-[#151515]"
          />
          <button
            type="submit"
            className="rounded-2xl border border-[#151515] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] transition hover:bg-[#151515] hover:text-white"
          >
            Добавить
          </button>
        </form>

        <div className="mt-5 grid gap-2">
          {proxyPool.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[#d8d8d2] px-4 py-8 text-center text-sm text-[#77766f]">
              Прокси пока не добавлены
            </p>
          ) : (
            proxyPool.map((proxyUrl, index) => (
              <div
                key={proxyUrl}
                className="grid gap-3 rounded-2xl border border-[#e1e1dc] bg-[#fbfaf5] px-4 py-3 text-sm md:grid-cols-[80px_1fr_auto]"
              >
                <span className="font-mono text-xs uppercase text-[#77766f]">#{index + 1}</span>
                <span className="truncate font-mono text-xs text-[#252525]">{proxyUrl}</span>
                <button
                  type="button"
                  onClick={() => removeProxy(proxyUrl)}
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#8a2d25] transition hover:text-[#b42318]"
                >
                  удалить
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {isCreateOpen ? (
        <CreateAccountPanel
          proxyPool={proxyPool}
          onClose={() => setIsCreateOpen(false)}
          onCreated={async () => {
            setIsCreateOpen(false);
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

function CreateAccountPanel({
  proxyPool,
  onClose,
  onCreated,
}: {
  proxyPool: string[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [selectedProxyUrl, setSelectedProxyUrl] = useState("");
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
        proxy_url: selectedProxyUrl || null,
        session_data_encrypted: JSON.stringify({
          auth_method: authMode,
          username_source: "session",
          password: authMode === "password" ? password : undefined,
          proxy: selectedProxyUrl || undefined,
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
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#77766f]">
              Новый профиль
            </p>
            <h2 className="mt-2 font-display text-3xl">Добавить аккаунт</h2>
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

          <label className="mt-8 grid gap-2">
            <span className="field-label">Прокси</span>
            <select
              value={selectedProxyUrl}
              onChange={(event) => setSelectedProxyUrl(event.target.value)}
              className="field-control"
            >
              <option value="">Без прокси / динамический IP</option>
              {proxyPool.map((proxyUrl) => (
                <option key={proxyUrl} value={proxyUrl}>
                  {proxyUrl}
                </option>
              ))}
            </select>
          </label>

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
  const tone = status === "active" ? "bg-[#edf8e8] text-[#25551f]" : status === "cookies_expired" || status === "blocked" ? "bg-[#fff4df] text-[#8a4b00]" : "bg-[#f7e8e5] text-[#8a2d25]";
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

function formatUsername(username: string) {
  return username === SESSION_USERNAME_PLACEHOLDER ? "Из сессии" : `@${username.replace(/^@/, "")}`;
}

function loadProxyPool() {
  try {
    const rawValue = window.localStorage.getItem(PROXY_POOL_STORAGE_KEY);
    const parsedValue = rawValue ? JSON.parse(rawValue) : [];
    return Array.isArray(parsedValue)
      ? parsedValue.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function saveProxyPool(proxyPool: string[]) {
  window.localStorage.setItem(PROXY_POOL_STORAGE_KEY, JSON.stringify(proxyPool));
}

import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { createAccount, getAccounts, type Account, type Platform } from "../../api/client";

const THREADS_PLATFORM: Platform = "threads";
const PROXY_POOL_STORAGE_KEY = "threadsbot.proxyPool";
const SESSION_USERNAME_PLACEHOLDER = "pending_from_session";

type AuthMode = "password" | "cookies";

export default function InfrastructurePage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [proxyPool, setProxyPool] = useState<string[]>(() => loadProxyPool());
  const [newProxyUrl, setNewProxyUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  async function loadAccounts() {
    setIsLoading(true);
    setError(null);

    try {
      setAccounts(await getAccounts());
    } catch {
      toast.error("Не удалось загрузить глобальный пул аккаунтов");
      setError("Не удалось загрузить глобальный пул аккаунтов.");
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
    if (!normalizedProxy || proxyPool.includes(normalizedProxy)) {
      if (proxyPool.includes(normalizedProxy)) {
        toast.error("Такой прокси уже есть в пуле");
      }
      setNewProxyUrl("");
      return;
    }

    const nextProxyPool = [...proxyPool, normalizedProxy];
    setProxyPool(nextProxyPool);
    saveProxyPool(nextProxyPool);
    setNewProxyUrl("");
    toast.success("Прокси добавлен в пул");
  }

  return (
    <section className="space-y-10">
      <div className="grid gap-6 border-b border-[#c9c9c3] pb-8 md:grid-cols-[1fr_auto]">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#77766f]">
            Global resource pool
          </p>
          <h1 className="mt-4 font-display text-5xl leading-none">Инфраструктура</h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-[#66645d]">
            Единый пул Threads-аккаунтов и прокси. Username больше не вводится
            вручную: скрипт должен получить его из авторизованной сессии.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="h-11 self-end border border-[#151515] bg-[#151515] px-5 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515]"
        >
          Добавить аккаунт
        </button>
      </div>

      {error ? <Notice>{error}</Notice> : null}

      <ResourceSection title="Аккаунты" eyebrow="Threads identity pool">
        <AccountsTable accounts={accounts} isLoading={isLoading} />
      </ResourceSection>

      <ResourceSection title="Пул прокси" eyebrow="Traffic routing">
        <form
          onSubmit={handleAddProxy}
          className="grid gap-4 border-b border-[#c9c9c3] p-4 md:grid-cols-[1fr_auto]"
        >
          <input
            value={newProxyUrl}
            onChange={(event) => setNewProxyUrl(event.target.value)}
            placeholder="http://user:pass@ip:port"
            className="field-control"
          />
          <button
            type="submit"
            className="border border-[#151515] px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] transition hover:bg-[#151515] hover:text-white"
          >
            Добавить прокси
          </button>
        </form>

        {proxyPool.length === 0 ? (
          <div className="px-4 py-12 text-center font-mono text-xs uppercase tracking-[0.18em] text-[#77766f]">
            Прокси еще не добавлены
          </div>
        ) : (
          <div>
            {proxyPool.map((proxyUrl, index) => (
              <div
                key={proxyUrl}
                className="grid grid-cols-[80px_1fr] border-b border-[#e1e1dc] px-4 py-4 text-sm last:border-b-0"
              >
                <span className="font-mono text-xs uppercase text-[#77766f]">#{index + 1}</span>
                <span className="truncate font-mono text-xs text-[#252525]">{proxyUrl}</span>
              </div>
            ))}
          </div>
        )}
      </ResourceSection>

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

function ResourceSection({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-[#c9c9c3] bg-white">
      <header className="border-b border-[#c9c9c3] px-4 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77766f]">
          {eyebrow}
        </p>
        <h2 className="mt-2 font-display text-3xl">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function AccountsTable({ accounts, isLoading }: { accounts: Account[]; isLoading: boolean }) {
  return (
    <div>
      <div className="grid grid-cols-[1fr_1.2fr_1.5fr_0.8fr_0.8fr] border-b border-[#c9c9c3] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#77766f]">
        <span>Платформа</span>
        <span>Username</span>
        <span>Прокси</span>
        <span>Статус</span>
        <span>Проект</span>
      </div>

      {isLoading ? (
        <div className="px-4 py-12 text-center font-mono text-xs uppercase tracking-[0.18em] text-[#77766f]">
          Загрузка аккаунтов
        </div>
      ) : accounts.length === 0 ? (
        <div className="px-4 py-16 text-center">
          <p className="font-display text-3xl">Пул аккаунтов пуст</p>
          <p className="mt-3 text-sm text-[#66645d]">
            Добавь первый Threads-аккаунт, затем привяжи его к нужному проекту.
          </p>
        </div>
      ) : (
        accounts.map((account) => (
          <div
            key={account.id}
            className="grid grid-cols-[1fr_1.2fr_1.5fr_0.8fr_0.8fr] border-b border-[#e1e1dc] px-4 py-4 text-sm last:border-b-0"
          >
            <span className="font-mono uppercase">{account.platform}</span>
            <span>{formatUsername(account.username)}</span>
            <span className="truncate font-mono text-xs text-[#66645d]">
              {account.proxy_url || "Без прокси / Динамический"}
            </span>
            <span className="font-mono text-xs uppercase">{account.status}</span>
            <span className="font-mono text-xs">
              {account.project_id === null ? "Свободен" : `#${account.project_id}`}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <div className="border-l-2 border-[#b42318] bg-white px-5 py-4 text-sm text-[#61140e]">
      {children}
    </div>
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
          : "Аккаунт не создан. Проверь API и формат данных.",
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
              Account pool
            </p>
            <h2 className="mt-2 font-display text-3xl">Добавить аккаунт</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-[#151515] px-3 py-2 font-mono text-xs uppercase transition hover:bg-[#151515] hover:text-white"
          >
            Закрыть
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto px-7 py-8">
          <label className="grid gap-2">
            <span className="field-label">Platform</span>
            <select value={THREADS_PLATFORM} disabled className="field-control opacity-70">
              <option value="threads">Threads</option>
            </select>
          </label>

          <div className="mt-8 border-l border-[#c9c9c3] pl-4 text-xs leading-5 text-[#66645d]">
            Username не вводится вручную. После первой проверки сессии Selenium должен
            прочитать имя аккаунта из Threads и обновить запись.
          </div>

          <div className="mt-8">
            <span className="field-label">Тип авторизации</span>
            <div className="mt-3 grid grid-cols-2 border border-[#151515]">
              <AuthTab
                label="По паролю"
                isActive={authMode === "password"}
                onClick={() => setAuthMode("password")}
              />
              <AuthTab
                label="По Cookies"
                isActive={authMode === "cookies"}
                onClick={() => setAuthMode("cookies")}
              />
            </div>
          </div>

          {authMode === "password" ? (
            <Field label="Password" value={password} onChange={setPassword} type="password" required />
          ) : (
            <label className="mt-8 grid gap-2">
              <span className="field-label">Cookies JSON / Cookie string</span>
              <textarea
                value={cookiesInput}
                onChange={(event) => setCookiesInput(event.target.value)}
                required
                rows={8}
                placeholder='[{"name":"sessionid","value":"...","domain":".threads.net"}]'
                className="field-control resize-none leading-6"
              />
              <div className="border-l border-[#c9c9c3] pl-4 text-xs leading-5 text-[#66645d]">
                Как получить куки: установите расширение Cookie-Editor или EditThisCookie,
                зайдите на threads.net под своим аккаунтом, нажмите Export JSON и вставьте
                содержимое сюда. Это исключит ввод пароля и снизит риск блокировки.
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
              <option value="">Без прокси / Динамический</option>
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
              className="w-full border border-[#151515] bg-[#151515] px-5 py-4 font-mono text-xs uppercase tracking-[0.16em] text-white transition hover:bg-transparent hover:text-[#151515] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? "Создание" : "Добавить аккаунт"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function AuthTab({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
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

function normalizeCookies(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error("Вставь JSON-массив cookies или cookie-строку.");
  }

  try {
    const parsedCookies = JSON.parse(trimmedValue);
    return JSON.stringify(parsedCookies);
  } catch {
    return JSON.stringify(trimmedValue);
  }
}

function formatUsername(username: string) {
  return username === SESSION_USERNAME_PLACEHOLDER ? "Из сессии" : username;
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

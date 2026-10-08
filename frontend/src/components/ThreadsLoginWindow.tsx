import { useEffect, useRef, useState } from "react";
import { apiClient, getApiErrorMessage } from "../api/client";
import { trackSeoEvent } from "./SeoAnalytics";

export default function ThreadsLoginWindow({ onClose, onConnected, onUseImport }: { onClose: () => void; onConnected: () => void; onUseImport?: () => void }) {
  const [username, setUsername] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [frame, setFrame] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const pending = useRef(false);
  const inputQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const queuedCount = useRef(0);
  const inputEpoch = useRef(0);
  const blockedInput = useRef(false);
  const [inputBlocked, setInputBlocked] = useState(false);
  const typedText = useRef("");
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const finishing = useRef(false);
  const [inputBusy, setInputBusy] = useState(false);
  const frameRequest = useRef<Promise<unknown> | null>(null);
  const textVersion = useRef(0);
  const starting = useRef(false);
  const [remaining, setRemaining] = useState(0);
  const deadline = useRef(0);
  const tokenRef = useRef<string | null>(null);
  const active = useRef(true);
  const previousFocus = useRef<HTMLElement | null>(typeof document === "undefined" ? null : document.activeElement as HTMLElement);
  const headers = token ? { "X-Login-Window": token } : {};

  useEffect(() => {
    active.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
    document.body.style.overflow = previousOverflow;
    if (previousFocus.current?.isConnected) previousFocus.current.focus();
    active.current = false;
    clearTimeout(typingTimer.current);
    typedText.current = "";
    if (tokenRef.current) void apiClient.post("/api/v1/threads-login/stop", {}, { headers: { "X-Login-Window": tokenRef.current } }).catch(() => {});
  }; }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let ended = false;
    let previous: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        if (!pending.current) {
          const request = apiClient.get("/api/v1/threads-login/frame", { headers: { "X-Login-Window": token }, responseType: "blob", timeout: 40000 });
          frameRequest.current = request;
          const result = await request;
          if (!cancelled) {
            const next = URL.createObjectURL(result.data);
            setFrame(next);
            if (previous) URL.revokeObjectURL(previous);
            previous = next;
          }
        }
      } catch (e) {
        if (!cancelled) {
          ended = (e as { response?: { status?: number } }).response?.status === 404;
          if (ended) { deadline.current = 0; setRemaining(0); }
          setError("Не удалось обновить окно. Если вход истёк, закройте его и откройте снова.");
        }
      } finally {
        frameRequest.current = null;
        if (!cancelled && !ended) timer = setTimeout(refresh, 1200);
      }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); if (previous) URL.revokeObjectURL(previous); };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [token]);

  async function start() {
    if (starting.current) return;
    starting.current = true;
    setBusy(true); setError("");
    try {
      const result = await apiClient.post("/api/v1/threads-login/start", { username: username.trim().replace(/^@/, "") }, { timeout: 60000 });
      if (!active.current) { void apiClient.post("/api/v1/threads-login/stop", {}, { headers: { "X-Login-Window": result.data.token } }).catch(() => {}); return; }
      deadline.current = Date.now() + result.data.expires_in * 1000;
      tokenRef.current = result.data.token;
      setToken(result.data.token);
    } catch (e) { if (active.current) setError(getApiErrorMessage(e, "Не удалось открыть окно входа.")); }
    finally { starting.current = false; if (active.current) setBusy(false); }
  }

  function command(data: object): Promise<boolean> {
    if (!token || !active.current || remaining <= 0 || blockedInput.current) return Promise.resolve(false);
    if (queuedCount.current >= 30) { setError("Окно отвечает медленно. Подождите, пока закончатся действия."); return Promise.resolve(false); }
    const epoch = inputEpoch.current;
    queuedCount.current += 1;
    pending.current = true; setInputBusy(true);
    const run = async () => {
      try {
        if (!active.current || epoch !== inputEpoch.current) return false;
        await frameRequest.current?.catch(() => {});
        if (!active.current) return false;
        await apiClient.post("/api/v1/threads-login/input", data, { headers, timeout: 40000 });
        if (active.current) setError("");
        return true;
      } catch (e) {
        // Discard subsequent queued input after an uncertain result; never replay it.
        inputEpoch.current += 1;
        blockedInput.current = true;
        if (active.current) setInputBlocked(true);
        clearTimeout(typingTimer.current);
        typedText.current = "";
        if (active.current) setError(getApiErrorMessage(e, "Действие не завершилось. Проверьте окно перед следующим действием."));
        return false;
      } finally {
        queuedCount.current -= 1;
        pending.current = queuedCount.current > 0 || typedText.current.length > 0;
        if (active.current) setInputBusy(pending.current);
      }
    };
    inputQueue.current = inputQueue.current.then(run, run);
    return inputQueue.current;
  }

  function flushTypedText() {
    clearTimeout(typingTimer.current);
    const value = typedText.current;
    typedText.current = "";
    if (value) return command({ kind: "text", text: value });
    return inputQueue.current;
  }

  function typeCharacter(value: string) {
    if (blockedInput.current) return;
    if (typedText.current.length + value.length > 1024) void flushTypedText();
    typedText.current += value;
    pending.current = true; setInputBusy(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => void flushTypedText(), 180);
  }

  async function finish() {
    if (finishing.current || !token || blockedInput.current) return;
    finishing.current = true; setBusy(true); setError("");
    try {
      const entered = await flushTypedText();
      if (!entered || !active.current) return;
      pending.current = true;
      await frameRequest.current?.catch(() => {});
      if (!active.current) return;
      await apiClient.post("/api/v1/threads-login/finish", {}, { headers, timeout: 40000 });
      tokenRef.current = null;
      if (!active.current) return;
      trackSeoEvent("threads_connection_verified", { method: "browser_window" });
      onConnected();
    } catch (e) { if (active.current) setError(getApiErrorMessage(e, "Не удалось подтвердить профиль.")); }
    finally { finishing.current = false; pending.current = queuedCount.current > 0 || typedText.current.length > 0; if (active.current) setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="threads-window-title" onKeyDown={e => {
    if (e.defaultPrevented) return;
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key !== "Tab") return;
    const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
    const first = controls[0], last = controls[controls.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }}>
    <section className="mx-auto max-w-5xl rounded-3xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-4 text-[var(--workspace-ink)] shadow-xl sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><h2 id="threads-window-title" className="font-display text-2xl">Войти в Threads</h2><p className="mt-2 text-sm text-[#66645d]">Отдельный браузер на сервере ThreadsGo. Войдите сами, затем подключите профиль. Окно действует 15 минут.</p></div><button onClick={onClose} className="rounded-xl border px-3 py-2" aria-label="Закрыть окно входа">Закрыть</button></div>
      {!token ? <form className="mt-6 space-y-4" onSubmit={e => { e.preventDefault(); void start(); }}><label className="block text-sm">Какой профиль подключаем?<input autoFocus required pattern="@?[A-Za-z0-9_.]{2,30}" value={username} onChange={e => setUsername(e.target.value)} placeholder="@username" className="mt-2 block w-full rounded-xl border bg-transparent p-3" /></label><p className="text-sm text-[#66645d]">Пароль вводится в открывшееся окно сайта Threads. Проверки и коды подтверждения проходите самостоятельно. Изображение окна и введённый текст передаются через ThreadsGo; мы не записываем их в журнал. Сохранится только сессия для работы подключённого профиля.</p><button disabled={busy} className="rounded-xl bg-[#151515] px-5 py-3 text-white disabled:opacity-50">{busy ? "Открываем браузер…" : "Открыть окно входа"}</button></form> : <>
        <p className="mt-4 text-sm" role="status">{remaining > 0 ? `Осталось ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "Срок окна истёк. Закройте его и откройте снова."}{inputBusy ? " · Выполняем действие…" : ""}</p>
        <p className="my-4 text-sm">На компьютере нажмите на поле в окне и печатайте как обычно. Можно вставить текст сочетанием Ctrl+V. На телефоне используйте «Ввести текст». После входа откройте главную ленту Threads.</p>
        {frame ? <img src={frame} alt="Окно Threads: нажмите на поле и введите текст" tabIndex={0} className="w-full rounded-xl border bg-white focus:outline focus:outline-2 focus:outline-[var(--workspace-ring)]" onClick={e => { if (busy || remaining <= 0) return; e.currentTarget.focus(); void flushTypedText(); const rect = e.currentTarget.getBoundingClientRect(); void command({kind:"click",x:Math.min(1023,Math.floor((e.clientX-rect.left)*1024/rect.width)),y:Math.min(767,Math.floor((e.clientY-rect.top)*768/rect.height))}); }} onPaste={e => { if (busy || remaining <= 0) return; const value = e.clipboardData.getData("text"); if (!value) return; e.preventDefault(); if (value.length > 1024) { setError("Вставьте текст длиной до 1024 символов."); return; } void flushTypedText(); void command({kind:"text",text:value}); }} onKeyDown={e => {
          if (busy || remaining <= 0 || e.nativeEvent.isComposing) return;
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (["Enter","Tab","Backspace","ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) { e.preventDefault(); void flushTypedText(); void command({kind:"key",key:e.key}); }
          else if (e.key.length === 1) { e.preventDefault(); typeCharacter(e.key); }
        }} /> : <div className="my-6 rounded-xl border p-8">Загружаем окно…</div>}
        <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer py-3">Ввести текст — для телефона или если клавиатура не работает</summary>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (text) { const version = textVersion.current; void flushTypedText(); void command({kind:"text",text}).then(ok => { if (ok && textVersion.current === version) setText(""); }); } }}><input type="password" autoComplete="off" aria-label="Текст в выбранное поле Threads" placeholder="Текст в выбранное поле" value={text} maxLength={1024} onChange={e => { textVersion.current += 1; setText(e.target.value); }} className="min-w-0 flex-1 rounded-xl border bg-transparent p-3" /><button disabled={inputBusy || busy || remaining <= 0} className="rounded-xl border px-4 disabled:opacity-50">Ввести</button><button type="button" disabled={inputBusy || busy || remaining <= 0} onClick={() => void command({kind:"key",key:"Backspace"})} className="rounded-xl border px-3">Удалить символ</button></form></details>
        <div className="mt-3 flex gap-2"><button type="button" disabled={inputBusy || busy || remaining <= 0} onClick={() => void command({kind:"scroll",delta:600})} className="min-h-11 rounded-xl border px-3">Прокрутить вниз</button><button type="button" disabled={inputBusy || busy || remaining <= 0} onClick={() => void command({kind:"scroll",delta:-600})} className="min-h-11 rounded-xl border px-3">Вверх</button></div>
        <button disabled={busy || inputBusy || inputBlocked || remaining <= 0} onClick={() => void finish()} className="mt-4 rounded-xl bg-[#151515] px-5 py-3 text-white disabled:opacity-50">{busy ? "Проверяем профиль…" : "Я вошёл — подключить профиль"}</button>
      </>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-300 p-3 text-sm text-red-700">{error}</p>}
      {inputBlocked && <div className="mt-3 text-sm"><p>Ввод остановлен, чтобы не отправить текст в неверное поле. Посмотрите на окно и убедитесь, что последнее действие завершилось.</p><button type="button" disabled={inputBusy || busy || remaining <= 0} onClick={() => { blockedInput.current = false; setInputBlocked(false); setError(""); }} className="mt-2 min-h-11 rounded-xl border px-4">Проверил окно — продолжить ввод</button></div>}
      <details className="mt-4 rounded-xl border border-[var(--workspace-border)] p-3 text-sm"><summary className="cursor-pointer">Threads не пускает или проверки повторяются?</summary><p className="mt-3 leading-6 text-[var(--workspace-muted)]">Если видите «Try again later» или сообщение об автоматических запросах, остановите попытки. Повторное открытие окна может не помочь. Проверьте вход в своём обычном браузере. Если там всё работает, можно перенести данные входа сюда. Этот способ тоже может потребовать проверки Threads.</p>{onUseImport && <button type="button" disabled={busy || starting.current} onClick={onUseImport} className="mt-3 min-h-11 rounded-xl border px-4 disabled:opacity-50">Перенести вход из своего браузера</button>}</details>
    </section>
  </div>;
}

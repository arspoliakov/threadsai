const API_ORIGIN = "https://threadsgo.ru";
const THREADS_DOMAINS = ["threads.net", "threads.com"];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "THREADSGO_CONNECT_THREADS" || typeof message.token !== "string") {
    return false;
  }

  connectThreadsProfile(message.token)
    .then((account) => sendResponse({ ok: true, account }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "Не удалось подключить профиль." }));

  return true;
});

async function connectThreadsProfile(token) {
  const cookieGroups = await Promise.all(
    THREADS_DOMAINS.map((domain) => chrome.cookies.getAll({ domain })),
  );
  const cookies = deduplicateCookies(cookieGroups.flat());

  if (!cookies.some((cookie) => cookie.name === "sessionid")) {
    throw new Error("Сначала откройте Threads в этом браузере и войдите в нужный профиль.");
  }

  const response = await fetch(`${API_ORIGIN}/api/v1/accounts/extension-links/consume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, cookies }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : "Не удалось передать cookies в ThreadsGo.";
    throw new Error(detail);
  }

  return payload;
}

function deduplicateCookies(cookies) {
  const unique = new Map();
  for (const cookie of cookies) {
    const key = `${cookie.storeId}:${cookie.domain}:${cookie.path}:${cookie.name}`;
    unique.set(key, cookie);
  }
  return Array.from(unique.values());
}

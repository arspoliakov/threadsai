window.postMessage({ source: "threadsgo-extension", type: "THREADSGO_EXTENSION_READY" }, window.location.origin);

window.addEventListener("message", (event) => {
  const message = event.data;
  if (event.source === window && message?.source === "threadsgo-web" && message?.type === "THREADSGO_EXTENSION_PING") {
    window.postMessage({ source: "threadsgo-extension", type: "THREADSGO_EXTENSION_READY" }, window.location.origin);
    return;
  }

  if (
    event.source !== window
    || message?.source !== "threadsgo-web"
    || message?.type !== "THREADSGO_CONNECT_THREADS"
  ) {
    return;
  }

  chrome.runtime.sendMessage(
    { type: "THREADSGO_CONNECT_THREADS", token: message.token },
    (response) => {
      const runtimeError = chrome.runtime.lastError?.message;
      window.postMessage(
        {
          source: "threadsgo-extension",
          type: "THREADSGO_CONNECT_RESULT",
          ok: Boolean(response?.ok) && !runtimeError,
          account: response?.account,
          error: runtimeError || response?.error || null,
        },
        window.location.origin,
      );
    },
  );
});

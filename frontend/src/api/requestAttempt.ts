// Keep a retry tied to the same operation, including after a page reload.
// Only a digest and a random key are stored, never the user's answers.
const attempts = new Map<string, string>();
export async function requestAttempt(scope: string, payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
  const storageKey = `threadsgo.request.${scope}.${fingerprint}`;
  let key = attempts.get(storageKey);
  try { key = sessionStorage.getItem(storageKey) || key; } catch { /* Memory fallback. */ }
  key ||= crypto.randomUUID();
  attempts.set(storageKey, key);
  try { sessionStorage.setItem(storageKey, key); } catch { /* Memory fallback. */ }
  return { key, complete: () => {
    attempts.delete(storageKey);
    try { sessionStorage.removeItem(storageKey); } catch { /* Memory fallback. */ }
  } };
}

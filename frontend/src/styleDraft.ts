import { getStoredAuthToken } from "./api/client";

function draftKey() {
  try {
    const token = getStoredAuthToken();
    const encoded = token?.split(".")[1];
    if (!encoded) return null;
    const id = JSON.parse(atob(encoded.replace(/-/g,"+").replace(/_/g,"/"))).sub;
    return /^\d+$/.test(String(id)) ? `threadsgo.style-draft.${id}` : null;
  } catch { return null; }
}

export function readStyleDraft(): string | null {
  try {
    const key = draftKey();
    if (!key) return null;
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    if (typeof value?.body !== "string" || !Number.isFinite(value.savedAt) || value.savedAt > Date.now() || Date.now()-value.savedAt > 86400000) {
      sessionStorage.removeItem(key); return null;
    }
    return value.body.slice(0, 30000);
  } catch { return null; }
}

export function saveStyleDraft(body: string) {
  try {
    const key = draftKey();
    if (key) sessionStorage.setItem(key, JSON.stringify({body:body.slice(0,30000), savedAt:Date.now()}));
  } catch { /* Optional recovery must never block editing. */ }
}

export function clearStyleDraft() {
  try { const key = draftKey(); if (key) sessionStorage.removeItem(key); } catch {}
}

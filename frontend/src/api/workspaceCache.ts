/** Coalesce owner-scoped reads; mutations and authentication changes invalidate them. */
const entries = new Map<string, { value: Promise<unknown>; expires: number }>();
let identity: string | null = null;
let epoch = 0;
export function invalidateWorkspaceData() { entries.clear(); epoch++; }
export function workspaceRead<T>(key: string, token: string | null, read: () => Promise<T>): Promise<T> {
  if (identity !== token) { identity = token; invalidateWorkspaceData(); }
  const existing = entries.get(key);
  if (existing && existing.expires > Date.now()) return existing.value as Promise<T>;
  const generation = epoch;
  const value = read().catch(error => { if (generation === epoch) entries.delete(key); throw error; });
  entries.set(key, { value, expires: Date.now() + 15000 });
  return value;
}

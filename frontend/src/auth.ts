import { clearStoredAuthToken, getStoredAuthToken, login, setStoredAuthToken } from "./api/client";

const AUTH_STORAGE_KEY = "threadsbot.authenticated";

export function isAuthenticated() {
  return Boolean(getStoredAuthToken());
}

export async function authenticate(password: string) {
  try {
    const response = await login(password);
    setStoredAuthToken(response.access_token);
    window.localStorage.setItem(AUTH_STORAGE_KEY, "true");
    return true;
  } catch {
    logout();
    return false;
  }
}

export function logout() {
  clearStoredAuthToken();
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

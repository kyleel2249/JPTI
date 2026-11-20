const STORAGE_KEY = 'jpti.apiBaseUrl';

export function getApiBaseUrl() {
  if (typeof window === 'undefined') return '';
  return String(window.localStorage.getItem(STORAGE_KEY) || '').trim().replace(/\/$/, '');
}

export function validateApiBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { valid: true, value: '' };
  let parsed;
  try { parsed = new URL(raw); } catch { return { valid: false, error: 'Enter a complete URL such as https://your-jpti.pages.dev.' }; }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    return { valid: false, error: 'Use only the API origin or Pages site origin. Do not include credentials, paths, query strings or fragments.' };
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local) {
    return { valid: false, error: 'Remote API connections must use HTTPS. Plain HTTP is allowed only for localhost.' };
  }
  return { valid: true, value: parsed.origin };
}

export function setApiBaseUrl(value) {
  const result = validateApiBaseUrl(value);
  if (!result.valid) throw new Error(result.error);
  if (typeof window !== 'undefined') {
    if (result.value) window.localStorage.setItem(STORAGE_KEY, result.value);
    else window.localStorage.removeItem(STORAGE_KEY);
  }
  return result.value;
}

export function apiUrl(path) {
  const normalizedPath = String(path || '');
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;
  const base = getApiBaseUrl();
  return base + (normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath);
}

export function apiFetch(path, options) {
  return fetch(apiUrl(path), options);
}

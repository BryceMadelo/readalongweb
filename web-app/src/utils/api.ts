export function getApiToken() {
  return localStorage.getItem('readalong_api_token') || '';
}

export function setApiToken(token: string) {
  localStorage.setItem('readalong_api_token', token);
}

export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = getApiToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth-error'));
  }
  return res;
}

export function getApiToken() {
  return localStorage.getItem('readalong_api_token') || '';
}

export function setApiToken(token: string) {
  localStorage.setItem('readalong_api_token', token);
}

export function removeApiToken() {
  localStorage.removeItem('readalong_api_token');
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

export async function fetchBooks() {
  const res = await fetchWithAuth('http://localhost:3000/api/books');
  if (!res.ok) throw new Error('Failed to fetch books');
  return res.json();
}

export async function getEpubBlob(bookId: string): Promise<Blob> {
  const res = await fetchWithAuth(`http://localhost:3000/api/books/${bookId}/epub`);
  if (!res.ok) throw new Error('Failed to download EPUB');
  return res.blob();
}

export async function getAudioBlob(bookId: string): Promise<Blob> {
  const res = await fetchWithAuth(`http://localhost:3000/api/books/${bookId}/audio`);
  if (!res.ok) throw new Error('Failed to download audio');
  return res.blob();
}

export async function getSyncMap(bookId: string): Promise<any[]> {
  const res = await fetchWithAuth(`http://localhost:3000/api/sync_map/${bookId}`);
  if (!res.ok) throw new Error('Failed to download sync map');
  return res.json();
}

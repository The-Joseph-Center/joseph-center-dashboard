const SANITY_PROXY_URL = '/.netlify/functions/sanity-proxy';

export async function useSanityQuery<T = unknown>(query: string, params?: Record<string, unknown>): Promise<T> {
  const res = await fetch(SANITY_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params }),
  });

  if (!res.ok) {
    throw new Error(`Sanity proxy error: ${res.status}`);
  }

  const data = await res.json();
  return data.result as T;
}

// JSON GET with a timeout and a per-tab cache (sessionStorage), to spare the public APIs' quotas.
export const getJson = async (url: string, { timeout = 8000 } = {}): Promise<any> => {
  const key = `cache:${url}`;
  try {
    const hit = sessionStorage.getItem(key);
    if (hit) return JSON.parse(hit);
  } catch {}
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  try { sessionStorage.setItem(key, JSON.stringify(json)); } catch {} // full or blocked: no cache
  return json;
};

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData)
      ? { 'Content-Type': 'application/json', ...init?.headers }
      : init?.headers,
  })
  const text = await res.text()
  const data = text ? (() => { try { return JSON.parse(text) } catch { return { error: text } } })() : null
  if (res.status === 401 && data?.unauthenticated) {
    window.dispatchEvent(new CustomEvent('mm-unauthenticated'))
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '' || v === false) continue
    out.set(k, String(v))
  }
  const s = out.toString()
  return s ? `?${s}` : ''
}

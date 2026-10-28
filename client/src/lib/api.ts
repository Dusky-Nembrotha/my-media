// Vite sets BASE_URL from the build's `base`; '/' when mounted at the root.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api'

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
  /*
   * Uploads go through XMLHttpRequest rather than fetch, which cannot report
   * how far a request body has got. A ten-megabyte export over a tunnel takes
   * long enough that a motionless "Reading…" is indistinguishable from a
   * hang — and there was no timeout either, so a stalled connection waited
   * for ever rather than saying so.
   */
  upload: <T>(path: string, form: FormData, onProgress?: (fraction: number) => void) =>
    new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', BASE + path)
      xhr.withCredentials = true
      xhr.timeout = 10 * 60 * 1000
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total)
      }
      xhr.onload = () => {
        const text = xhr.responseText
        let data: any = null
        if (text) { try { data = JSON.parse(text) } catch { data = { error: text } } }
        if (xhr.status === 401 && data?.unauthenticated) {
          window.dispatchEvent(new CustomEvent('mm-unauthenticated'))
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data as T)
        else reject(new Error(data?.error || `Request failed (${xhr.status})`))
      }
      xhr.onerror = () => reject(new Error('The upload never reached the server — check the connection and try again.'))
      xhr.ontimeout = () => reject(new Error('The upload timed out after ten minutes.'))
      xhr.onabort = () => reject(new Error('The upload was cancelled.'))
      xhr.send(form)
    }),
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

/** Shared fetch options: include the session cookie on every request. */
const baseInit: RequestInit = { credentials: 'include' }

function redirectToLogin(): never {
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
  throw new Error('unauthorized')
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) redirectToLogin()
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      detail = body.error ?? ''
    } catch {
      detail = res.statusText
    }
    throw new Error(detail || `request failed (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { ...baseInit, method: 'GET' })
  return handle<T>(res)
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    ...baseInit,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handle<T>(res)
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    ...baseInit,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handle<T>(res)
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    ...baseInit,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handle<T>(res)
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { ...baseInit, method: 'DELETE' })
  return handle<T>(res)
}

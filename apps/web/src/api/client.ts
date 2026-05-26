import { useAuth } from '../store/auth'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  auth?: boolean
}

let refreshPromise: Promise<boolean> | null = null

async function attemptRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const { refreshToken, setTokens, clear } = useAuth.getState()
    if (!refreshToken) {
      clear()
      return false
    }
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) {
        clear()
        return false
      }
      const data = await res.json()
      setTokens(data.access_token, data.refresh_token, data.expires_in)
      return true
    } catch {
      clear()
      return false
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

export async function api<T = unknown>(
  path: string,
  { method = 'GET', body, auth = false }: Options = {},
): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (auth) {
      const t = useAuth.getState().accessToken
      if (t) headers.Authorization = `Bearer ${t}`
    }
    return fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  let res = await doFetch()
  if (res.status === 401 && auth) {
    const ok = await attemptRefresh()
    if (ok) res = await doFetch()
  }

  if (!res.ok) {
    let code = 'http_error'
    let message = `Request failed with status ${res.status}`
    try {
      const data = await res.json()
      if (typeof data?.error === 'string') code = data.error
      if (typeof data?.message === 'string') message = data.message
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, code, message)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

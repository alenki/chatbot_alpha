import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'

const COOKIE_NAME = 'admin_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** HMAC-SHA256 of ("admin" + expiry) keyed by the session secret, lowercase hex. */
function sign(expiry: number, secret: string): string {
  return createHmac('sha256', secret).update(`admin${expiry}`).digest('hex')
}

/** Builds a "<expiry>.<hmac>" cookie value. `expiry` override exists only for tests. */
export function issueSessionCookie(secret: string, expiry: number = Date.now() + SESSION_TTL_MS): string {
  return `${expiry}.${sign(expiry, secret)}`
}

/** True iff the value is well-formed, the HMAC matches (timing-safe), and the expiry is in the future. */
export function verifySessionCookie(value: string | undefined, secret: string): boolean {
  if (value === undefined) return false
  const dot = value.indexOf('.')
  if (dot <= 0) return false
  const expiryRaw = value.slice(0, dot)
  const mac = value.slice(dot + 1)
  if (!/^\d+$/.test(expiryRaw) || !/^[0-9a-f]{64}$/.test(mac)) return false
  const expiry = Number(expiryRaw)
  const expected = sign(expiry, secret)
  const a = Buffer.from(mac, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  return expiry > Date.now()
}

export interface AuthOptions {
  password: string
  secret: string
}

/**
 * Registers the login route and the auth gate. Must run after `@fastify/cookie`
 * is registered. The gate is an onRequest hook: every `/api/*` request except
 * `/api/login` requires a valid `admin_session` cookie.
 */
export function registerAuth(app: FastifyInstance, opts: AuthOptions): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return // static assets / SPA fallback are public
    if (req.method === 'POST' && req.url.split('?')[0] === '/api/login') return
    const raw = req.cookies[COOKIE_NAME]
    if (!verifySessionCookie(raw, opts.secret)) {
      await reply.code(401).send({ error: 'unauthorized' })
    }
  })

  app.post<{ Body: { password?: string } }>('/api/login', async (req, reply) => {
    const supplied = typeof req.body?.password === 'string' ? req.body.password : ''
    // Timing-safe password compare; pad to equal length so the comparison itself
    // does not leak the password length.
    const a = Buffer.from(supplied)
    const b = Buffer.from(opts.password)
    const max = Math.max(a.length, b.length)
    const pa = Buffer.alloc(max)
    const pb = Buffer.alloc(max)
    a.copy(pa)
    b.copy(pb)
    const ok = a.length === b.length && timingSafeEqual(pa, pb)
    if (!ok) {
      return reply.code(401).send({ error: 'invalid password' })
    }
    reply.setCookie(COOKIE_NAME, issueSessionCookie(opts.secret), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    })
    return reply.send({ ok: true })
  })
}

import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { issueSessionCookie, verifySessionCookie, registerAuth } from './auth.js'

const SECRET = 'a-session-secret-of-32-characters'

describe('session cookie helpers', () => {
  it('issues a "<expiry>.<hmac>" value that round-trips through verify', () => {
    const value = issueSessionCookie(SECRET)
    expect(value).toMatch(/^\d+\.[0-9a-f]{64}$/)
    expect(verifySessionCookie(value, SECRET)).toBe(true)
  })

  it('rejects a tampered HMAC', () => {
    const value = issueSessionCookie(SECRET)
    const [expiry] = value.split('.')
    const forged = `${expiry}.${'0'.repeat(64)}`
    expect(verifySessionCookie(forged, SECRET)).toBe(false)
  })

  it('rejects an expired cookie even with a valid HMAC for that expiry', () => {
    // Craft a cookie whose expiry is in the past but whose HMAC is correct.
    const past = Date.now() - 1000
    const value = issueSessionCookie(SECRET, past)
    expect(verifySessionCookie(value, SECRET)).toBe(false)
  })

  it('rejects malformed values', () => {
    expect(verifySessionCookie('', SECRET)).toBe(false)
    expect(verifySessionCookie('garbage', SECRET)).toBe(false)
    expect(verifySessionCookie('123', SECRET)).toBe(false)
    expect(verifySessionCookie('notanumber.deadbeef', SECRET)).toBe(false)
  })

  it('rejects a cookie signed with a different secret', () => {
    const value = issueSessionCookie('another-secret-of-32-characters!!')
    expect(verifySessionCookie(value, SECRET)).toBe(false)
  })
})

async function buildAuthApp(password = 'super-secret-password') {
  const app = Fastify()
  await app.register(cookie)
  registerAuth(app, { password, secret: SECRET })
  app.get('/api/protected', async () => ({ ok: true }))
  await app.ready()
  return app
}

describe('login route + requireAuth preHandler', () => {
  it('POST /api/login with the wrong password returns 401 and sets no cookie', async () => {
    const app = await buildAuthApp()
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'nope' } })
    expect(res.statusCode).toBe(401)
    expect(res.headers['set-cookie']).toBeUndefined()
    await app.close()
  })

  it('POST /api/login with the right password returns 200 and sets the admin_session cookie', async () => {
    const app = await buildAuthApp()
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'super-secret-password' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toContain('admin_session=')
    expect(setCookie).toContain('HttpOnly')
    await app.close()
  })

  it('blocks a protected route without a cookie (401)', async () => {
    const app = await buildAuthApp()
    const res = await app.inject({ method: 'GET', url: '/api/protected' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('allows a protected route once logged in (cookie reused)', async () => {
    const app = await buildAuthApp()
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'super-secret-password' } })
    const cookieHeader = String(login.headers['set-cookie']).split(';')[0]
    const res = await app.inject({ method: 'GET', url: '/api/protected', headers: { cookie: cookieHeader } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    await app.close()
  })

  it('never gates /api/login itself behind auth', async () => {
    const app = await buildAuthApp()
    // No cookie present: login must still be reachable (otherwise you could never log in).
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'super-secret-password' } })
    expect(res.statusCode).toBe(200)
    await app.close()
  })
})

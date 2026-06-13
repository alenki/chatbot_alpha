import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import type { Db } from '../db/client.js'
import type { AppConfig } from '../config.js'
import type { Channel, ChannelAdapter } from '../channels/types.js'
import type { Logger } from '../log.js'
import { registerAuth } from './auth.js'
import { registerChatsRoutes } from './routes/chats.js'
import { registerOrdersRoutes } from './routes/orders.js'
import { registerCatalogRoutes } from './routes/catalog.js'
import { registerFaqRoutes } from './routes/faq.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerUsageRoutes } from './routes/usage.js'

export interface AdminServerDeps {
  db: Db
  config: AppConfig
  engine: { adapters: Map<Channel, ChannelAdapter> }
  log: Logger
}

/** The built admin SPA lives at admin/dist relative to the repo root (server/src/admin → ../../../admin/dist). */
function adminDistDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', '..', '..', 'admin', 'dist')
}

export async function buildAdminServer(deps: AdminServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  await app.register(cookie)

  registerAuth(app, { password: deps.config.ADMIN_PASSWORD, secret: deps.config.SESSION_SECRET })

  registerChatsRoutes(app, { db: deps.db, adapters: deps.engine.adapters, log: deps.log })
  registerOrdersRoutes(app, { db: deps.db })
  registerCatalogRoutes(app, { db: deps.db })
  registerFaqRoutes(app, { db: deps.db })
  registerSettingsRoutes(app, { db: deps.db })
  registerUsageRoutes(app, { db: deps.db })

  // Production: serve the built SPA and fall back to index.html for client-side routes.
  // Skipped in development/test — there `vite` serves the SPA and proxies /api here.
  if (deps.config.NODE_ENV === 'production') {
    const dist = adminDistDir()
    if (existsSync(dist)) {
      const { default: fastifyStatic } = await import('@fastify/static')
      await app.register(fastifyStatic, { root: dist, prefix: '/' })
      app.setNotFoundHandler((req, reply) => {
        // API 404s stay JSON; everything else returns the SPA shell for client routing.
        if (req.url.startsWith('/api/')) {
          return reply.code(404).send({ error: 'not found' })
        }
        return reply.sendFile('index.html')
      })
    } else {
      deps.log.warn({ dist }, 'admin/dist not found — SPA will not be served')
    }
  }

  return app
}

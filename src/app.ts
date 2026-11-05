import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'
import { createCache } from './cache'
import { ClientSafeError, HTTPError, log } from './errors'
import { createRouter } from './router'

export const version = 'v4'

export type AppConfig = {
  rateLimit?: number | undefined
  isRateLimitSkipped?: (() => boolean) | undefined
}

export const createApp = (config: AppConfig = {}) => {
  const app = new Hono()
  const cache = createCache()

  let currentRateLimit = config.rateLimit

  app.use('*', cors())

  app.get('/', (c) => {
    return c.json({
      message: 'Welcome to the GitHub Contributions API.',
      version,
      docs: 'https://github.com/linuskang/github-contributions-api',
    })
  })

  app.get(`/${version}`, (c) => {
    return c.redirect('/', 302)
  })

  const router = createRouter(cache, {
    getRateLimit: () => currentRateLimit,
    isRateLimitSkipped: config.isRateLimitSkipped,
  })

  app.route(`/${version}`, router)

  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json(
        {
          error: 'Invalid request',
          issues: error.issues.map((i) => ({
            code: i.code,
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        400,
      )
    }

    if (error instanceof HTTPError) {
      for (const [key, val] of Object.entries(error.headers)) {
        if (val !== undefined) {
          c.header(key, val)
        }
      }
      return c.json(
        { error: error.message },
        error.statusCode as ContentfulStatusCode,
      )
    }

    if (error instanceof ClientSafeError) {
      return c.json({ error: error.message }, 500)
    }

    log(error instanceof Error ? error.message : 'Unknown error', 'error')
    return c.json({ error: 'Internal server error' }, 500)
  })

  // Helper method for testing configuration
  const testableApp = Object.assign(app, {
    setRateLimit: (limit: number | undefined) => {
      currentRateLimit = limit
    },
    getCache: () => cache,
  })

  return testableApp
}

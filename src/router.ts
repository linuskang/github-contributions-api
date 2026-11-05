import { Hono } from 'hono'
import stableStringify from 'json-stable-stringify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  ageInSeconds,
  type CacheItem,
  computeEtag,
  type createCache,
} from './cache'
import { scrapeContributions } from './github'
import { createRateLimiter } from './rate-limit'

export type RouterOptions = {
  getRateLimit?: (() => number | undefined) | undefined
  isRateLimitSkipped?: (() => boolean) | undefined
}

export const routeSchema = z.object({
  // GitHub: Username may only contain alphanumeric characters or single hyphens
  // and cannot begin or end with a hyphen.
  username: z
    .string()
    .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, {
      error: 'Invalid GitHub username',
    })
    .transform((u) => u.toLowerCase()),
})

export const querySchema = z.object({
  y: z
    .union([
      z.string().regex(/^(?:\d+|all|last)$/, {
        error: 'Invalid input: expected one or more number(s), "all" or "last"',
      }),
      z.array(
        z.string().regex(/^\d+$/, {
          error:
            'Invalid input: expected one or more number(s), "all" or "last"',
        }),
      ),
    ])
    .optional()
    .transform((y, ctx) => {
      if (y === undefined) {
        return 'all'
      }

      if (y === 'all' || y === 'last') {
        return y
      }

      const years = typeof y === 'string' ? [Number(y)] : y.map(Number)
      const parsedYears = z.array(z.int()).safeParse(years)

      if (!parsedYears.success) {
        ctx.addIssue({
          code: 'invalid_value',
          message: parsedYears.error.message,
          values: years,
        })
        return z.NEVER
      }

      return uniq(parsedYears.data).sort()
    }),
  format: z.literal('nested').optional(),
})

export type ReqQuery = z.output<typeof querySchema>

export const parseQueryFromUrl = (url: URL) => {
  const yParams = url.searchParams.getAll('y')
  const format = url.searchParams.get('format')

  const input: { y?: string | Array<string>; format?: string } = {}

  if (yParams.length === 1) {
    input.y = yParams[0]
  } else if (yParams.length > 1) {
    input.y = yParams
  }

  if (format !== null) {
    input.format = format
  }

  return input
}

export const getCacheKey = (username: string, query: ReqQuery) => {
  const queryString = stableStringify(query)
  if (!queryString) {
    throw new Error('Unexpected error: empty query')
  }

  const queryHash = createHash('sha256').update(queryString).digest('base64url')

  return `cache-${username.toLowerCase()}-${queryHash}`
}

const uniq = <T = unknown>(a: Array<T>) => [...new Set(a)]

export const createRouter = (
  cache: ReturnType<typeof createCache>,
  options?: RouterOptions,
) => {
  const router = new Hono()

  const limiter = createRateLimiter({
    windowMs: 10 * 1000,
    limit: () => options?.getRateLimit?.() ?? 10,
    skip: () => {
      if (options?.isRateLimitSkipped) {
        return options.isRateLimitSkipped()
      }
      return process.env.NODE_ENV === 'test'
    },
  })

  router.get('/:username', limiter, async (c) => {
    const rawUsername = c.req.param('username')
    const url = new URL(c.req.url)
    const rawQuery = parseQueryFromUrl(url)

    const routeResult = routeSchema.safeParse({ username: rawUsername })
    const queryResult = querySchema.safeParse(rawQuery)

    if (!routeResult.success || !queryResult.success) {
      const issues = [
        ...(routeResult.error?.issues ?? []),
        ...(queryResult.error?.issues ?? []),
      ]
      return c.json(
        {
          error: 'Invalid request',
          issues: issues.map((i) => ({
            code: i.code,
            message: i.message,
            path: i.path.join('.'),
          })),
        },
        400,
      )
    }

    const { username } = routeResult.data
    const query = queryResult.data
    const cacheKey = getCacheKey(username, query)

    const isNoCache = c.req.header('cache-control') === 'no-cache'

    if (!isNoCache) {
      const cached = cache.get(cacheKey)

      if (cached !== undefined) {
        const age = ageInSeconds(cached)
        const etag = computeEtag(cached.response)
        const ifNoneMatch = c.req.header('if-none-match')

        if (ifNoneMatch) {
          const normalize = (tag: string) =>
            tag.replace(/^W\//, '').replaceAll('"', '')
          if (normalize(ifNoneMatch) === normalize(etag)) {
            c.header('age', String(age))
            c.header('x-cache', 'HIT')
            c.header('etag', etag)
            return c.body(null, 304)
          }
        }

        c.header('age', String(age))
        c.header('x-cache', 'HIT')
        c.header('etag', etag)
        return c.json(cached.response)
      }
    }

    const response = await scrapeContributions(username, query)
    const cacheItem: CacheItem = { ts: Date.now(), response }

    cache.set(cacheKey, cacheItem)

    const etag = computeEtag(response)

    c.header('age', '0')
    c.header('x-cache', 'MISS')
    c.header('etag', etag)

    return c.json(response)
  })

  return router
}

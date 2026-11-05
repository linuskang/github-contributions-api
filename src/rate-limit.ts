import type { Context, MiddlewareHandler } from 'hono'

type RateLimitOptions = {
  windowMs?: number
  limit?: number | ((c: Context) => number | undefined)
  skip?: (c: Context) => boolean
}

type RecordItem = {
  count: number
  resetTime: number
}

export const createRateLimiter = (
  options: RateLimitOptions = {},
): MiddlewareHandler => {
  const windowMs = options.windowMs ?? 10 * 1000
  const records = new Map<string, RecordItem>()

  const cleanup = () => {
    const now = Date.now()
    for (const [key, record] of records.entries()) {
      if (record.resetTime <= now) {
        records.delete(key)
      }
    }
  }

  return async (c, next) => {
    if (options.skip?.(c)) {
      return next()
    }

    const limit =
      typeof options.limit === 'function'
        ? (options.limit(c) ?? 10)
        : (options.limit ?? 10)

    if (limit <= 0) {
      return next()
    }

    const ip =
      c.req.header('cf-connecting-ip') ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      '127.0.0.1'

    const now = Date.now()
    let record = records.get(ip)

    if (!record || record.resetTime <= now) {
      record = { count: 1, resetTime: now + windowMs }
      records.set(ip, record)
    } else {
      record.count += 1
    }

    if (records.size > 1000) {
      cleanup()
    }

    if (record.count > limit) {
      return c.json(
        { error: 'Too many requests, please try again later.' },
        429,
      )
    }

    return next()
  }
}

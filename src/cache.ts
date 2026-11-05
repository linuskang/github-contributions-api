import { TTLCache } from '@isaacs/ttlcache'
import { createHash } from 'node:crypto'
import type { NestedResponse, Response } from './github'

export type CacheItem = {
  ts: number // UNIX timestamp in ms
  response: Response | NestedResponse
}

export const createCache = () => {
  return new TTLCache<string, CacheItem>({
    max: 10_000,
    ttl: 60 * 60 * 1000, // one hour
  })
}

export const ageInSeconds = (c: CacheItem) =>
  Math.floor((Date.now() - c.ts) / 1000)

export const computeEtag = (body: unknown): string => {
  const str = typeof body === 'string' ? body : JSON.stringify(body)
  const hash = createHash('sha256').update(str).digest('base64url').slice(0, 27)
  return `"${hash}"`
}

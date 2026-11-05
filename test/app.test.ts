import { TTLCache } from '@isaacs/ttlcache'
import { eachDayOfInterval, format as formatDate } from 'date-fns'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createApp, version } from '../src/app'
import type * as github from '../src/github'
import testDataMultipleYears from './fixtures/grubersjoe-2017-2018.json'
import testDataNested from './fixtures/grubersjoe-2018-nested.json'
import testData from './fixtures/grubersjoe-2018.json'

const username = 'grubersjoe'

type RequestResult<T> = {
  status: number
  headers: Record<string, string | undefined>
  body: T
  res: Response
}

const makeRequest = async <T = Record<string, unknown>>(
  app: ReturnType<typeof createApp>,
  path: string,
  init?: RequestInit,
): Promise<RequestResult<T>> => {
  const res = await app.request(path, init)
  const contentType = res.headers.get('content-type') ?? ''
  let body: unknown = null
  if (res.status !== 304 && contentType.includes('application/json')) {
    body = await res.json()
  }
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: body as T,
    res,
  }
}

describe('The API endpoints', () => {
  let app = createApp()

  afterEach(() => {
    vi.restoreAllMocks()
    app = createApp()
  })

  test('returns welcome message on GET /', async () => {
    const { status, body } = await makeRequest(app, '/')
    expect(status).toBe(200)
    expect(body).toMatchObject({
      message: 'Welcome to the GitHub Contributions API.',
      version,
      docs: 'https://github.com/linuskang/github-contributions-api',
    })
  })

  test('redirects GET /v4 to /', async () => {
    const { status, headers } = await makeRequest(app, `/${version}`)
    expect(status).toBe(302)
    expect(headers.location).toBe('/')
  })

  test.each([[''], ['y=all']])('returns all data for query %s', async (y) => {
    const { status, body } = await makeRequest(
      app,
      `/${version}/${username}?${y}`,
    )
    expect(status).toBe(200)
    const typedBody = body as github.Response
    expect(Object.keys(typedBody.total).length).toBeGreaterThanOrEqual(14)

    for (const count of Object.values(typedBody.total)) {
      expect(typeof count).toBe('number')
    }
  })

  test('returns data for a single year', async () => {
    const { status, body } = await makeRequest(
      app,
      `/${version}/${username}?y=2018`,
    )
    expect(status).toBe(200)
    expect(body).toStrictEqual(testData)
  })

  test('returns data for several years', async () => {
    const { status, body } = await makeRequest(
      app,
      `/${version}/${username}?y=2017&y=2018`,
    )
    expect(status).toBe(200)
    expect(body).toStrictEqual(testDataMultipleYears)
  })

  test('returns data for the last year', async () => {
    const { status, body } = await makeRequest(
      app,
      `/${version}/${username}?y=last`,
    )
    expect(status).toBe(200)
    const typedBody = body as github.Response
    expect(Object.keys(typedBody.total)).toContain('lastYear')
    expect(typeof typedBody.total.lastYear).toBe('number')
  })

  test('returns data in the nested format', async () => {
    const { status, body } = await makeRequest(
      app,
      `/${version}/${username}?y=2018&format=nested`,
    )
    expect(status).toBe(200)
    expect(body).toStrictEqual(testDataNested)
  })

  test('returns an empty response if no data is available', async () => {
    const { status, body } = await makeRequest(
      app,
      `/${version}/${username}?y=1900`,
    )
    expect(status).toBe(200)
    const typedBody = body as github.Response
    expect(typedBody.total).toStrictEqual({ 1900: 0 })

    eachDayOfInterval({
      start: new Date(1900, 0, 1),
      end: new Date(1900, 11, 31),
    }).forEach((date, index) => {
      expect(typedBody.contributions[index]).toStrictEqual({
        date: formatDate(date, 'yyyy-MM-dd'),
        count: 0,
        level: 0,
      })
    })
  })

  test('returns HTTP 404 if the user cannot be found', async () => {
    const logSpy = vi.spyOn(global.console, 'error')
    const nonExistingUser = '43b83cb5-2d8f-44d3-b01c-98a73af7a15f'

    const { status, body } = await makeRequest(
      app,
      `/${version}/${nonExistingUser}`,
    )
    expect(status).toBe(404)
    expect(body).toStrictEqual({
      error: `GitHub user "${nonExistingUser}" not found.`,
    })

    expect(logSpy).not.toHaveBeenCalled()
  })

  test('returns HTTP 400 for invalid username', async () => {
    const { status, body } = await makeRequest(app, `/${version}/-invalid`)
    expect(status).toBe(400)
    expect(body).toStrictEqual({
      error: 'Invalid request',
      issues: [
        {
          code: 'invalid_format',
          message: 'Invalid GitHub username',
          path: 'username',
        },
      ],
    })
  })

  test.each([['y='], ['y=invalid'], ['y=2020abc'], ['y=abc2020']])(
    'returns HTTP 400 for invalid query %s',
    async (y) => {
      const { status, body } = await makeRequest(
        app,
        `/${version}/${username}?${y}`,
      )
      expect(status).toBe(400)
      expect(body).toStrictEqual({
        error: 'Invalid request',
        issues: [
          {
            code: 'invalid_format',
            message:
              'Invalid input: expected one or more number(s), "all" or "last"',
            path: 'y',
          },
        ],
      })
    },
  )

  test.each([['format=invalid'], ['format=']])(
    'returns HTTP 400 for invalid format query %s',
    async (formatQuery) => {
      const { status, body } = await makeRequest(
        app,
        `/${version}/${username}?${formatQuery}`,
      )
      expect(status).toBe(400)
      expect(body).toStrictEqual({
        error: 'Invalid request',
        issues: [
          {
            code: 'invalid_value',
            message: 'Invalid input: expected "nested"',
            path: 'format',
          },
        ],
      })
    },
  )

  test('combines all validation errors', async () => {
    const { status, body } = await makeRequest(
      app,
      `/${version}/${username}?y=invalid&format=invalid`,
    )
    expect(status).toBe(400)
    expect(body).toStrictEqual({
      error: 'Invalid request',
      issues: [
        {
          code: 'invalid_format',
          message:
            'Invalid input: expected one or more number(s), "all" or "last"',
          path: 'y',
        },
        {
          code: 'invalid_value',
          message: 'Invalid input: expected "nested"',
          path: 'format',
        },
      ],
    })
  })

  test.each([
    [
      new Response('💥', {
        status: 429,
        headers: { 'retry-after': '300' },
      }),
      429,
      'GitHub: Too many requests.',
      { 'retry-after': '300' },
    ],
    [
      new Error('💥'),
      500,
      `Failed to scrape contributions of "${username}"`,
      {},
    ],
    [new Response('💥', { status: 502 }), 502, 'GitHub: Bad gateway.', {}],
    [
      new Response('💥', { status: 503 }),
      503,
      'GitHub: Service unavailable.',
      {},
    ],
    [new Response('💥', { status: 504 }), 504, 'GitHub: Gateway timeout.', {}],
  ])(
    'returns HTTP $1 for respective error',
    async (errOrResponse, expectedStatus, expectedError, expectedHeaders) => {
      if (errOrResponse instanceof Response) {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(errOrResponse)
      } else {
        vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(errOrResponse)
      }

      const { status, body, headers } = await makeRequest(
        app,
        `/${version}/${username}`,
      )
      expect(status).toBe(expectedStatus)
      expect(body).toStrictEqual({ error: expectedError })

      for (const [header, value] of Object.entries(expectedHeaders)) {
        expect(headers[header]).toStrictEqual(value)
      }
    },
  )

  test('does not leak internal errors', async () => {
    vi.spyOn(TTLCache.prototype, 'set').mockImplementation(() => {
      throw new Error('💥')
    })

    const { status, body } = await makeRequest(
      app,
      `/${version}/${username}?y=2018`,
    )
    expect(status).toBe(500)
    expect(body).toStrictEqual({
      error: 'Internal server error',
    })
  })

  test('caches responses', async () => {
    const resp = await makeRequest(app, `/${version}/${username}?y=2020`)
    expect(resp.status).toBe(200)
    expect(Number(resp.headers.age)).toBe(0)
    expect(resp.headers['x-cache']).toBe('MISS')

    await new Promise((resolve) => setTimeout(resolve, 1000))

    const cached = await makeRequest(
      app,
      `/${version}/${username.toUpperCase()}?y=2020`,
      {
        headers: {
          'if-none-match': resp.headers.etag ?? '',
        },
      },
    )

    expect(cached.status).toBe(304)
    expect(Number(cached.headers.age)).toBeGreaterThanOrEqual(1)
    expect(cached.headers['x-cache']).toBe('HIT')
  })

  test('ignores cache for cache-control: no-cache', async () => {
    const resp1 = await makeRequest(app, `/${version}/${username}?y=2020`)
    expect(resp1.status).toBe(200)
    expect(Number(resp1.headers.age)).toBe(0)
    expect(resp1.headers['x-cache']).toBe('MISS')

    const resp2 = await makeRequest(app, `/${version}/${username}?y=2020`, {
      headers: {
        'cache-control': 'no-cache',
      },
    })
    expect(resp2.status).toBe(200)
    expect(Number(resp2.headers.age)).toBe(0)
    expect(resp2.headers['x-cache']).toBe('MISS')
  })

  test('enforces rate limit', async () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    app.setRateLimit(1)

    const resp1 = await makeRequest(app, `/${version}/${username}?y=2020`)
    expect(resp1.status).toBe(200)

    const resp2 = await makeRequest(app, `/${version}/${username}?y=2020`)
    expect(resp2.status).toBe(429)
    expect(resp2.body).toEqual({
      error: 'Too many requests, please try again later.',
    })

    process.env.NODE_ENV = originalEnv
  })
})

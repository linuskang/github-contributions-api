import * as cheerio from 'cheerio'
import { Element, isText } from 'domhandler'
import { ClientSafeError, HTTPError } from './errors'
import type { ReqQuery } from './router'

type Level = 0 | 1 | 2 | 3 | 4

export type Contribution = {
  date: string
  count: number
  level: Level
}

export type Response = {
  total: {
    [year: number]: number
    [year: string]: number // 'lastYear'
  }
  contributions: Array<Contribution>
}

export type NestedResponse = {
  total: {
    [year: number]: number
    [year: string]: number // 'lastYear'
  }
  contributions: Record<number, Record<number, Record<number, Contribution>>> // [y][m][d]
}

const mapConcurrent = async <T, R>(
  items: Array<T>,
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<R>> => {
  const results = new Array<R>(items.length)
  let index = 0

  const worker = async () => {
    while (index < items.length) {
      const current = index
      index += 1
      const item = items[current]
      if (item !== undefined) {
        results[current] = await fn(item)
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

/**
 * @throws {HTTPError | ClientSafeError}
 */
export const scrapeContributions = async (
  username: string,
  query: ReqQuery,
): Promise<Response | NestedResponse> => {
  let contributions: Array<Response | NestedResponse>

  if (query.y === 'all') {
    const allYears = await fetchAllYearsFor(username)
    contributions = await mapConcurrent(allYears, 4, (year) =>
      scrapeYear(username, year, query.format),
    )
  } else if (query.y === 'last') {
    contributions = [await scrapeYear(username, query.y, query.format)]
  } else {
    contributions = await mapConcurrent(query.y, 4, (year) =>
      scrapeYear(username, year, query.format),
    )
  }

  if (query.format === 'nested') {
    return (contributions as Array<NestedResponse>).reduce(
      (resp, curr) => ({
        total: { ...resp.total, ...curr.total },
        contributions: { ...resp.contributions, ...curr.contributions },
      }),
      {
        total: {},
        contributions: {},
      },
    )
  }

  return (contributions as Array<Response>).reduce(
    (resp, curr) => ({
      total: { ...resp.total, ...curr.total },
      contributions: [...resp.contributions, ...curr.contributions],
    }),
    {
      total: {},
      contributions: [],
    },
  )
}

/**
 * @throws {HTTPError | ClientSafeError}
 */
const fetchHtml = async (url: string, username: string): Promise<string> => {
  let response: globalThis.Response
  try {
    response = await fetch(url, requestOptions(username))
  } catch (error) {
    if (error instanceof HTTPError || error instanceof ClientSafeError) {
      throw error
    }
    throw new ClientSafeError(`Failed to scrape contributions of "${username}"`)
  }

  if (response.status === 404) {
    throw new HTTPError(404, `GitHub user "${username}" not found.`)
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') ?? undefined
    throw new HTTPError(
      429,
      'GitHub: Too many requests.',
      retryAfter ? { 'retry-after': retryAfter } : undefined,
    )
  }
  if (response.status === 502) {
    throw new HTTPError(502, 'GitHub: Bad gateway.')
  }
  if (response.status === 503) {
    throw new HTTPError(503, 'GitHub: Service unavailable.')
  }
  if (response.status === 504) {
    throw new HTTPError(504, 'GitHub: Gateway timeout.')
  }
  if (!response.ok) {
    throw new ClientSafeError(`Failed to scrape contributions of "${username}"`)
  }

  return response.text()
}

/**
 * @throws {HTTPError | ClientSafeError}
 */
const scrapeYear = async (
  username: string,
  year: number | 'last',
  format?: 'nested',
): Promise<Response | NestedResponse> => {
  const url =
    year === 'last'
      ? `https://github.com/users/${username}/contributions`
      : `https://github.com/users/${username}/contributions?tab=overview&from=${year}-12-01&to=${year}-12-31`

  const html = await fetchHtml(url, username)
  const $ = cheerio.load(html)

  const days = $('.js-calendar-graph-table .ContributionCalendar-day')
  const sortedDays = days.get().sort((a, b) => {
    const dateA = a.attribs['data-date'] ?? ''
    const dateB = b.attribs['data-date'] ?? ''

    return dateA.localeCompare(dateB, 'en')
  })

  const totalMatch = /^([0-9,]+)\s/.exec(
    $('.js-yearly-contributions h2').text().trim(),
  )

  if (!totalMatch) {
    throw new Error('Failed parsing total contributions count')
  }

  const total = parseInt(totalMatch[0].replaceAll(',', ''))

  // Required for contribution count
  const tooltipsByDayId = $('.js-calendar-graph tool-tip')
    .toArray()
    .reduce<Record<string, Element>>((map, elem) => {
      if (elem.attribs.for) {
        map[elem.attribs.for] = elem
      }
      return map
    }, {})

  const response = {
    total: {
      [year === 'last' ? 'lastYear' : year]: total,
    },
    contributions: {},
  }

  if (format === 'nested') {
    return sortedDays.reduce<NestedResponse>((data, day) => {
      const { date, contribution } = parseDay(day, tooltipsByDayId)
      const [y, m, d] = date

      data.contributions[y] ??= {}
      data.contributions[y][m] ??= {}
      data.contributions[y][m][d] = contribution

      return data
    }, response)
  }

  return {
    ...response,
    contributions: sortedDays.map(
      (day) => parseDay(day, tooltipsByDayId).contribution,
    ),
  }
}

const parseDay = (day: Element, tooltipsByDayId: Record<string, Element>) => {
  const attr = {
    id: day.attribs.id,
    date: day.attribs['data-date'],
    level: day.attribs['data-level'],
  }

  if (!attr.date) {
    throw new Error('Failed parsing contribution date attribute')
  }

  if (!attr.level) {
    throw new Error('Failed parsing contribution level attribute')
  }

  let count = 0

  const tooltip = attr.id ? tooltipsByDayId[attr.id] : undefined
  const text = tooltip?.firstChild
  if (text && isText(text)) {
    const countMatch = /^\d+/.exec(text.data.trim())
    if (countMatch) {
      count = parseInt(countMatch[0])
    }
  }

  const level = parseInt(attr.level) as Level

  if (isNaN(count)) {
    throw new Error('Failed parsing contribution count')
  }

  if (isNaN(level)) {
    throw new Error('Failed parsing contribution level')
  }

  const contribution: Contribution = {
    date: attr.date,
    count,
    level,
  }

  return {
    date: attr.date.split('-').map((d: string) => parseInt(d)),
    contribution,
  }
}

/**
 * @throws {HTTPError | ClientSafeError}
 */
const fetchAllYearsFor = async (username: string): Promise<Array<number>> => {
  const url = `https://github.com/${username}?action=show&controller=profiles&tab=contributions&user_id=${username}`
  const html = await fetchHtml(url, username)
  const $ = cheerio.load(html)

  return $('.js-year-link')
    .get()
    .map((a) => parseInt($(a).text().trim()))
}

const requestOptions = (username: string): RequestInit => ({
  method: 'GET',
  headers: {
    accept: 'text/html',
    referer: `https://github.com/${username}`,
    'x-requested-with': 'XMLHttpRequest',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
})

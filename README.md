# GitHub Contributions API (Cloudflare Worker)

[![CI](https://github.com/linuskang/github-contributions-api/actions/workflows/test.yml/badge.svg)](https://github.com/linuskang/github-contributions-api/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A high-performance serverless API that scrapes and serves GitHub user
contribution graphs and stats, rewritten specifically to run on **Cloudflare
Workers** using **Hono** and **TypeScript**.

This API is 100% schema-compatible with
[grubersjoe/github-contributions-api](https://github.com/grubersjoe/github-contributions-api),
making it a drop-in replacement for portfolio heatmaps and components like
[React GitHub Calendar](https://github.com/grubersjoe/react-github-calendar).
Simply update your API host URL!

---

## Features

- ⚡ **Cloudflare Workers Native**: Ultra-low latency, running at the edge
  across 300+ locations worldwide.
- 🔄 **100% Drop-In Compatible**: Identical request parameters, response
  schemas, and error structures as the original API.
- 📦 **Zero Docker / Zero VM Maintenance**: Completely serverless, auto-scaling,
  and free on Cloudflare's free tier.
- 🚀 **Built with Hono & TypeScript**: Type-safe, fast cold starts, and minimal
  bundle footprint.
- ⏱️ **Edge & Memory Caching**: 1-hour cache with `Age`, `ETag`, `If-None-Match`
  (304 Not Modified), and `x-cache: HIT | MISS` headers.
- 🛡️ **Edge Rate Limiting**: Built-in protection against scraping abuse.
- 🚦 **Concurrency Managed**: Safe subrequest handling avoids triggering GitHub
  rate limits on multi-year requests.

---

## Quick Start & Deployment

### Prerequisites

- [Node.js](https://nodejs.org/) (v22+)
- [pnpm](https://pnpm.io/) (v10+)
- A [Cloudflare](https://dash.cloudflare.com/) account

### 1. Clone & Install

```shell
git clone https://github.com/linuskang/github-contributions-api.git
cd github-contributions-api
pnpm install
```

### 2. Local Development

Run the Cloudflare Workers dev server locally:

```shell
pnpm dev
```

Your API is now running locally at `http://localhost:8787`!

### 3. Deploy to Cloudflare Workers

Authenticate with Cloudflare and deploy:

```shell
pnpm deploy
```

Wrangler will output your live worker URL (e.g.,
`https://github-contributions-api.<your-subdomain>.workers.dev`).

---

## API Usage

### Endpoint

```http
GET https://<your-worker-domain>/v4/:username
```

#### Example

```shell
curl https://github-contributions-api.<your-subdomain>.workers.dev/v4/linuskang
```

#### Response Format (Default)

```json
{
  "total": {
    "2023": 492,
    "2024": 810,
    "2025": 1054
  },
  "contributions": [
    {
      "date": "2024-01-01",
      "count": 0,
      "level": 0
    },
    {
      "date": "2024-01-02",
      "count": 9,
      "level": 4
    },
    {
      "date": "2024-01-03",
      "count": 5,
      "level": 2
    }
  ]
}
```

---

### Query Parameters

| Parameter | Type               | Default | Description                                                                                                    |
| --------- | ------------------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| `y`       | `number \| string` | `all`   | Specific year (`2024`), multiple years (`?y=2023&y=2024`), `last` (last 12 months), or `all` (entire history). |
| `format`  | `string`           | _flat_  | Set to `nested` to get contributions grouped by year, month, and day.                                          |

#### Examples

- Retrieve last 12 months (GitHub's default view):

  ```shell
  GET /v4/linuskang?y=last
  ```

- Retrieve a specific year:

  ```shell
  GET /v4/linuskang?y=2024
  ```

- Retrieve multiple years:

  ```shell
  GET /v4/linuskang?y=2023&y=2024
  ```

- Retrieve nested format:
  ```shell
  GET /v4/linuskang?y=2024&format=nested
  ```

#### Nested Response Format

```json
{
  "total": {
    "2024": 810
  },
  "contributions": {
    "2024": {
      "1": {
        "1": {
          "date": "2024-01-01",
          "count": 0,
          "level": 0
        },
        "2": {
          "date": "2024-01-02",
          "count": 9,
          "level": 4
        }
      }
    }
  }
}
```

---

## Response TypeScript Interfaces

```typescript
type Level = 0 | 1 | 2 | 3 | 4

type Contribution = {
  date: string
  count: number
  level: Level
}

type Response = {
  total: {
    [year: number]: number
    [year: string]: number // 'lastYear'
  }
  contributions: Array<Contribution>
}

type NestedResponse = {
  total: {
    [year: number]: number
    [year: string]: number // 'lastYear'
  }
  contributions: Record<number, Record<number, Record<number, Contribution>>>
}

type ErrorResponse = {
  error: string
  issues?: Array<{
    code: string
    path: string
    message: string
  }>
}
```

---

## Caching & Rate Limiting

- **Caching**: Results are cached for 1 hour. Responses include:
  - `age`: Elapsed cache age in seconds.
  - `x-cache`: `HIT` or `MISS`.
  - `etag`: ETag hash for HTTP 304 conditional validation (`If-None-Match`).
  - To bypass the cache and force fresh data, supply `Cache-Control: no-cache`
    in your request.
- **Rate Limiting**: Uncached scraping requests are limited to 10 requests per
  10 seconds per IP address. Exceeded requests return
  `HTTP 429 Too Many Requests`.

---

## Development & Testing

```shell
# Run test suite
pnpm test

# Type checking
pnpm typecheck

# Code linting
pnpm lint

# Format code
pnpm format

# Verify all checks
pnpm check

# Dry-run Worker build bundle
pnpm build
```

---

## Credits & Acknowledgements

Originally created by
[Jonathan Gruber (@grubersjoe)](https://github.com/grubersjoe) as
[github-contributions-api](https://github.com/grubersjoe/github-contributions-api).
Rewritten for Cloudflare Workers by [Linus Kang](https://github.com/linuskang).

## License

[MIT](LICENSE)

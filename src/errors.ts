export class ClientSafeError extends Error {}

export class HTTPError extends Error {
  readonly statusCode: number
  readonly headers: Record<string, string | undefined>

  constructor(
    statusCode: number,
    message: string,
    headers?: Record<string, string | undefined>,
  ) {
    super(message)
    this.statusCode = statusCode
    this.headers = headers ?? {}
  }
}

export const log = (message: string, level?: 'warn' | 'error') => {
  console[level ?? 'log'](`[${new Date().toISOString()}] ${message}`)
}

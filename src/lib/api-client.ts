'use client';

/**
 * Browser-side API client.
 *
 * One place that knows the response envelope and the error shape, so every
 * component handles failures the same way and none of them reach into a raw
 * fetch response.
 */

export interface ApiFieldErrors {
  [field: string]: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: ApiFieldErrors;

  constructor(status: number, code: string, message: string, fields: ApiFieldErrors = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string; fields?: ApiFieldErrors };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
      // Session cookie must ride along.
      credentials: 'same-origin',
    });
  } catch {
    // A network failure has no status, but callers still need one error type.
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.');
  }

  let body: Envelope<T>;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server returned an unexpected response.',
    );
  }

  if (!response.ok || body.error) {
    throw new ApiError(
      response.status,
      body.error?.code ?? 'internal_error',
      body.error?.message ?? 'Something went wrong.',
      body.error?.fields ?? {},
    );
  }

  return body.data as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, payload?: unknown): Promise<T> =>
    request<T>(path, {
      method: 'POST',
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  patch: <T>(path: string, payload: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(payload) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData): Promise<T> =>
    request<T>(path, { method: 'POST', body: form }),
};

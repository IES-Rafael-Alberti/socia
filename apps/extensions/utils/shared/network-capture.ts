export const NETWORK_BODY_LIMIT = 16 * 1024;

export type NetworkCaptureSource = 'fetch' | 'xhr' | 'beacon';
export type NetworkCapturePhase = 'start' | 'finish';
export type NetworkCaptureOutcome = 'completed' | 'failed' | 'unknown';

export interface CapturedBody {
  value: string | null;
  originalLength: number;
  truncated: boolean;
}

export interface NetworkCaptureMessage {
  type: string;
  phase: NetworkCapturePhase;
  requestId: string;
  source: NetworkCaptureSource;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  documentUrl: string;
  method: string;
  url: string;
  responseUrl?: string;
  redirected?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  requestBody?: CapturedBody;
  responseBody?: CapturedBody;
  outcome?: NetworkCaptureOutcome;
  error?: string;
}

export interface FetchRequestDetails {
  method: string;
  url: string;
  body: Promise<CapturedBody>;
}

const STATIC_CONTENT_TYPES = [
  'text/css',
  'text/javascript',
  'application/javascript',
  'text/html',
  'image/',
  'font/',
  'application/wasm',
  'application/octet-stream',
  'audio/',
  'video/',
];

const SECRET_KEYS =
  'password|passwd|secret|token|access_token|refresh_token|apikey|api_key|authorization|cookie';

export function redactNetworkSecrets(value: string): string {
  return value
    .replace(
      new RegExp(`("(?:${SECRET_KEYS})"\\s*:\\s*)"[^"]*"`, 'gi'),
      '$1"[REDACTED]"'
    )
    .replace(
      new RegExp(`((?:^|[&?])(?:${SECRET_KEYS})=)[^&]*`, 'gi'),
      '$1[REDACTED]'
    );
}

export function captureText(value: string | null): CapturedBody {
  if (!value) {
    return { value: null, originalLength: 0, truncated: false };
  }
  const redacted = redactNetworkSecrets(value);
  const truncated = redacted.length > NETWORK_BODY_LIMIT;
  return {
    value: truncated
      ? `${redacted.slice(0, NETWORK_BODY_LIMIT)}...[truncated]`
      : redacted,
    originalLength: redacted.length,
    truncated,
  };
}

export function shouldRelayNetworkCapture(
  message: NetworkCaptureMessage,
  resolvedUrl: string
): boolean {
  if (message.phase !== 'finish' || resolvedUrl.startsWith('chrome-extension://')) {
    return false;
  }
  const contentType = message.contentType?.toLowerCase() ?? '';
  if (STATIC_CONTENT_TYPES.some((prefix) => contentType.includes(prefix))) {
    return false;
  }
  return !(
    message.outcome === 'completed' &&
    message.method === 'GET' &&
    (!contentType || contentType === 'application/binary')
  );
}

export async function serializeNetworkBody(body: unknown): Promise<string | null> {
  if (body === null || body === undefined) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    const parts: string[] = [];
    body.forEach((value, key) => {
      if (typeof value === 'string') {
        parts.push(`${key}=${value}`);
        return;
      }
      parts.push(
        `${key}=[File name="${value.name}" type="${value.type || 'unknown'}" size=${value.size}]`
      );
    });
    return parts.join('&');
  }
  if (body instanceof Blob) {
    if (
      body.type.includes('json') ||
      body.type.includes('xml') ||
      body.type.startsWith('text/')
    ) {
      return await body.text();
    }
    return `[Blob type="${body.type || 'unknown'}" size=${body.size}]`;
  }
  if (body instanceof ArrayBuffer) return `[Binary size=${body.byteLength}]`;
  if (ArrayBuffer.isView(body)) return `[Binary size=${body.byteLength}]`;
  return null;
}

async function captureNetworkBody(body: unknown): Promise<CapturedBody> {
  return captureText(await serializeNetworkBody(body));
}

export function getFetchRequestDetails(
  input: RequestInfo | URL,
  init?: RequestInit
): FetchRequestDetails {
  const request = input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const body =
    init?.body !== undefined
      ? captureNetworkBody(init.body)
      : request && method !== 'GET' && method !== 'HEAD'
        ? request.clone().text().then(captureText).catch(() => captureText(null))
        : Promise.resolve(captureText(null));
  return { method, url, body };
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `network_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isReadableContentType(contentType: string): boolean {
  return (
    contentType.includes('application/json') ||
    contentType.includes('application/xml') ||
    contentType.includes('application/graphql') ||
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('text/')
  );
}

function post(message: NetworkCaptureMessage): void {
  try {
    window.postMessage(message, '*');
  } catch {
    // Network logging must never break the page.
  }
}

export function installNetworkCapture(messageType: string, installFlag: string): void {
  const pageWindow = window as typeof window & Record<string, unknown>;
  if (pageWindow[installFlag]) return;
  pageWindow[installFlag] = true;

  const originalFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const id = requestId();
    const startedAt = Date.now();
    const documentUrl = window.location.href;
    const details = getFetchRequestDetails(input, init);
    const { method, url } = details;
    const bodyPromise = details.body;

    post({
      type: messageType,
      phase: 'start',
      requestId: id,
      source: 'fetch',
      startedAt,
      documentUrl,
      method,
      url,
    });

    return originalFetch.apply(this, [input, init]).then(
      (response) => {
        void (async () => {
          const finishedAt = Date.now();
          const contentType = response.headers.get('content-type') || '';
          let responseBody = captureText(null);
          if (isReadableContentType(contentType)) {
            try {
              responseBody = captureText(await response.clone().text());
            } catch {
              responseBody = captureText(null);
            }
          }
          post({
            type: messageType,
            phase: 'finish',
            requestId: id,
            source: 'fetch',
            startedAt,
            finishedAt,
            durationMs: finishedAt - startedAt,
            documentUrl,
            method,
            url,
            responseUrl: response.url || url,
            redirected: response.redirected || response.url !== url,
            status: response.status,
            statusText: response.statusText,
            contentType,
            requestBody: await bodyPromise,
            responseBody,
            outcome: 'completed',
          });
        })();
        return response;
      },
      (error) => {
        void bodyPromise.then((requestBody) => {
          const finishedAt = Date.now();
          post({
            type: messageType,
            phase: 'finish',
            requestId: id,
            source: 'fetch',
            startedAt,
            finishedAt,
            durationMs: finishedAt - startedAt,
            documentUrl,
            method,
            url,
            responseUrl: url,
            redirected: false,
            status: 0,
            statusText: '',
            contentType: '',
            requestBody,
            responseBody: captureText(null),
            outcome: 'failed',
            error: errorMessage(error),
          });
        });
        throw error;
      }
    );
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    const xhr = this as XMLHttpRequest & {
      __sociaMethod?: string;
      __sociaUrl?: string;
    };
    xhr.__sociaMethod = method.toUpperCase();
    xhr.__sociaUrl = typeof url === 'string' ? url : url.href;
    originalOpen.apply(this, [method, url, ...rest] as Parameters<XMLHttpRequest['open']>);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
    const xhr = this as XMLHttpRequest & {
      __sociaMethod?: string;
      __sociaUrl?: string;
    };
    const id = requestId();
    const startedAt = Date.now();
    const documentUrl = window.location.href;
    const method = xhr.__sociaMethod ?? 'GET';
    const url = xhr.__sociaUrl ?? '';
    const bodyPromise = captureNetworkBody(body);
    let requestError: string | undefined;

    post({
      type: messageType,
      phase: 'start',
      requestId: id,
      source: 'xhr',
      startedAt,
      documentUrl,
      method,
      url,
    });

    xhr.addEventListener('error', () => {
      requestError = 'Network error';
    }, { once: true });
    xhr.addEventListener('abort', () => {
      requestError = 'Request aborted';
    }, { once: true });
    xhr.addEventListener('timeout', () => {
      requestError = 'Request timed out';
    }, { once: true });
    xhr.addEventListener('loadend', () => {
      void (async () => {
        const finishedAt = Date.now();
        const contentType = xhr.getResponseHeader('content-type') || '';
        let responseText: string | null = null;
        if (xhr.responseType === '' || xhr.responseType === 'text') {
          responseText = typeof xhr.response === 'string' ? xhr.response : null;
        } else if (xhr.responseType === 'json' && xhr.response !== null) {
          responseText = JSON.stringify(xhr.response);
        }
        const responseUrl = xhr.responseURL || url;
        post({
          type: messageType,
          phase: 'finish',
          requestId: id,
          source: 'xhr',
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          documentUrl,
          method,
          url,
          responseUrl,
          redirected: responseUrl !== url,
          status: xhr.status,
          statusText: xhr.statusText,
          contentType,
          requestBody: await bodyPromise,
          responseBody: captureText(responseText),
          outcome: requestError ? 'failed' : 'completed',
          error: requestError,
        });
      })();
    }, { once: true });

    originalSend.apply(this, [body]);
  };

  if (typeof navigator.sendBeacon === 'function') {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url: string | URL, data?: BodyInit | null): boolean {
      const id = requestId();
      const startedAt = Date.now();
      const documentUrl = window.location.href;
      const requestUrl = typeof url === 'string' ? url : url.href;
      post({
        type: messageType,
        phase: 'start',
        requestId: id,
        source: 'beacon',
        startedAt,
        documentUrl,
        method: 'POST',
        url: requestUrl,
      });

      const accepted = originalSendBeacon(url, data);
      void captureNetworkBody(data).then((requestBody) => {
        const finishedAt = Date.now();
        post({
          type: messageType,
          phase: 'finish',
          requestId: id,
          source: 'beacon',
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
          documentUrl,
          method: 'POST',
          url: requestUrl,
          responseUrl: requestUrl,
          redirected: false,
          status: 0,
          statusText: '',
          contentType: '',
          requestBody,
          responseBody: captureText(null),
          outcome: accepted ? 'unknown' : 'failed',
          error: accepted ? undefined : 'Beacon was rejected',
        });
      });
      return accepted;
    };
  }
}

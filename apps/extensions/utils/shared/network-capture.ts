export const NETWORK_BODY_LIMIT = 16 * 1024;
export const NETWORK_URL_LIMIT = 8 * 1024;
export const NETWORK_TEXT_LIMIT = 2 * 1024;
export const NETWORK_REQUEST_ID_LIMIT = 128;

export type NetworkCaptureSource = 'fetch' | 'xhr' | 'beacon';
export type NetworkCapturePhase = 'start' | 'finish';
export type NetworkCaptureOutcome = 'completed' | 'failed' | 'unknown';

export interface CapturedBody {
  value: string | null;
  originalLength: number;
  truncated: boolean;
  redactions?: string[];
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
  urlRedactions?: string[];
  responseUrlRedactions?: string[];
  documentUrlRedactions?: string[];
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
  'password|passwd|pwd|passphrase|secret|token|access_token|refresh_token|id_token|session_token|apikey|api_key|authorization|cookie|client_secret|private_key|credential|assertion|otp|totp|pin|signature';

const AUTH_PATH = /(?:^|[/_.-])(auth|login|signin|oauth|token|session|sso|mfa|otp|password|credential)(?:[/_.-]|$)/i;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

export interface NetworkSanitizationContext {
  contentType?: string;
  url?: string;
}

export interface SanitizedUrl {
  value: string;
  redactions: string[];
  truncated: boolean;
}

function normalizeSecretKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, '');
}

function looksLikeSecretValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return SECRET_VALUE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function isAuthenticationUrl(url?: string): boolean {
  if (!url) return false;
  try {
    return AUTH_PATH.test(new URL(url, 'https://localhost').pathname);
  } catch {
    return AUTH_PATH.test(url);
  }
}

function isSecretField(key: string, value: unknown, url?: string): boolean {
  const normalized = normalizeSecretKey(key);
  if (
    /^(password|passwd|pwd|passphrase|secret|authorization|cookie|setcookie|apikey|accesstoken|refreshtoken|idtoken|sessiontoken|clientsecret|privatekey|credential|credentials|assertion|otp|totp|pin|signature|sig)$/.test(
      normalized
    ) ||
    normalized.endsWith('password') ||
    normalized.endsWith('token') ||
    normalized.endsWith('secret')
  ) {
    return true;
  }
  if (normalized === 'code' || normalized === 'key') {
    return isAuthenticationUrl(url) || looksLikeSecretValue(value);
  }
  return looksLikeSecretValue(value);
}

export function isSensitiveInputField(input: {
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  value?: string;
  url?: string;
}): boolean {
  if (input.type?.toLowerCase() === 'password') return true;
  const autocomplete = input.autocomplete?.toLowerCase() ?? '';
  if (
    autocomplete.includes('password') ||
    autocomplete.includes('one-time-code')
  ) {
    return true;
  }
  return (
    isSecretField(input.name ?? '', input.value, input.url) ||
    isSecretField(input.id ?? '', input.value, input.url) ||
    looksLikeSecretValue(input.value)
  );
}

function redactSecretValues(value: string, redactions: Set<string>): string {
  let result = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(result)) {
      redactions.add('$value');
      pattern.lastIndex = 0;
      result = result.replace(pattern, '[REDACTED]');
    }
  }
  return result;
}

function sanitizeStructuredValue(
  value: unknown,
  url: string | undefined,
  redactions: Set<string>,
  path = '$'
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeStructuredValue(item, url, redactions, `${path}[${index}]`)
    );
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      if (isSecretField(key, child, url)) {
        result[key] = '[REDACTED]';
        redactions.add(childPath);
      } else {
        result[key] = sanitizeStructuredValue(child, url, redactions, childPath);
      }
    }
    return result;
  }
  return typeof value === 'string' ? redactSecretValues(value, redactions) : value;
}

function sanitizeFormBody(
  value: string,
  url: string | undefined,
  redactions: Set<string>
): string | null {
  if (!value.includes('=')) return null;
  try {
    const params = new URLSearchParams(value);
    if ([...params.keys()].length === 0) return null;
    for (const key of new Set(params.keys())) {
      const values = params.getAll(key);
      params.delete(key);
      for (const item of values) {
        if (isSecretField(key, item, url)) {
          params.append(key, '[REDACTED]');
          redactions.add(`$.${key}`);
        } else {
          params.append(key, redactSecretValues(item, redactions));
        }
      }
    }
    return params.toString().replaceAll('%5BREDACTED%5D', '[REDACTED]');
  } catch {
    return null;
  }
}

function sanitizeXmlBody(
  value: string,
  url: string | undefined,
  redactions: Set<string>
): string {
  let result = value.replace(
    /<([A-Za-z_][\w:.-]*)\b([^>]*)>([^<]*)<\/\1>/g,
    (match, key: string, attrs: string, child: string) => {
      if (!isSecretField(key, child, url)) return match;
      redactions.add(`$.${key}`);
      return `<${key}${attrs}>[REDACTED]</${key}>`;
    }
  );
  result = result.replace(
    /([A-Za-z_][\w:.-]*)=(['"])(.*?)\2/g,
    (match, key: string, quote: string, child: string) => {
      if (!isSecretField(key, child, url)) return match;
      redactions.add(`$.@${key}`);
      return `${key}=${quote}[REDACTED]${quote}`;
    }
  );
  return redactSecretValues(result, redactions);
}

export function redactNetworkSecrets(value: string): string {
  const redactions = new Set<string>();
  const redacted = value
    .replace(
      new RegExp(`("(?:${SECRET_KEYS})"\\s*:\\s*)"[^"]*"`, 'gi'),
      '$1"[REDACTED]"'
    )
    .replace(
      new RegExp(`((?:^|[&?])(?:${SECRET_KEYS})=)[^&]*`, 'gi'),
      '$1[REDACTED]'
    );
  return redactSecretValues(redacted, redactions);
}

export function captureText(
  value: string | null,
  context: NetworkSanitizationContext = {}
): CapturedBody {
  if (!value) {
    return { value: null, originalLength: 0, truncated: false, redactions: [] };
  }
  const redactions = new Set<string>();
  const trimmed = value.trim();
  const contentType = context.contentType?.toLowerCase() ?? '';
  let redacted: string | null = null;

  if (
    contentType.includes('json') ||
    contentType.includes('graphql') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[')
  ) {
    try {
      redacted = JSON.stringify(
        sanitizeStructuredValue(JSON.parse(value), context.url, redactions)
      );
    } catch {
      // Fall through to the format-independent filters.
    }
  }
  if (redacted === null && (contentType.includes('xml') || trimmed.startsWith('<'))) {
    redacted = sanitizeXmlBody(value, context.url, redactions);
  }
  if (
    redacted === null &&
    (contentType.includes('x-www-form-urlencoded') || /^[^=&\s]+=[\s\S]*$/.test(trimmed))
  ) {
    redacted = sanitizeFormBody(value, context.url, redactions);
  }
  if (redacted === null) {
    redacted = redactNetworkSecrets(value);
    if (redacted !== value) redactions.add('$text');
    redacted = redactSecretValues(redacted, redactions);
  }

  const truncated = redacted.length > NETWORK_BODY_LIMIT;
  return {
    value: truncated
      ? `${redacted.slice(0, NETWORK_BODY_LIMIT)}...[truncated]`
      : redacted,
    originalLength: value.length,
    truncated,
    redactions: [...redactions].sort(),
  };
}

function sanitizeHash(hash: string, url: string, redactions: Set<string>): string {
  if (!hash) return '';
  const raw = hash.slice(1);
  const queryIndex = raw.indexOf('?');
  const route = queryIndex >= 0 ? raw.slice(0, queryIndex) : '';
  const query = queryIndex >= 0 ? raw.slice(queryIndex + 1) : raw;
  const sanitized = sanitizeFormBody(query, url, redactions);
  if (sanitized === null) {
    return `#${redactSecretValues(raw, redactions)}`;
  }
  return `#${route}${queryIndex >= 0 ? '?' : ''}${sanitized}`;
}

export function sanitizeNetworkUrl(raw: string): SanitizedUrl | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const redactions = new Set<string>();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    for (const key of new Set(parsed.searchParams.keys())) {
      const values = parsed.searchParams.getAll(key);
      parsed.searchParams.delete(key);
      for (const value of values) {
        if (isSecretField(key, value, parsed.href)) {
          parsed.searchParams.append(key, '[REDACTED]');
          redactions.add(`query.${key}`);
        } else {
          parsed.searchParams.append(key, redactSecretValues(value, redactions));
        }
      }
    }
    parsed.hash = sanitizeHash(parsed.hash, parsed.href, redactions);
    const value = parsed.href.replaceAll('%5BREDACTED%5D', '[REDACTED]');
    return {
      value: value.slice(0, NETWORK_URL_LIMIT),
      redactions: [...redactions].sort(),
      truncated: value.length > NETWORK_URL_LIMIT,
    };
  } catch {
    return null;
  }
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

export function sanitizeNetworkCaptureMessage(
  input: unknown,
  resolvedUrl: string
): NetworkCaptureMessage | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<NetworkCaptureMessage>;
  if (
    raw.phase !== 'finish' ||
    !['fetch', 'xhr', 'beacon'].includes(raw.source ?? '') ||
    typeof raw.requestId !== 'string' ||
    raw.requestId.length === 0 ||
    raw.requestId.length > NETWORK_REQUEST_ID_LIMIT ||
    typeof raw.method !== 'string' ||
    !/^[A-Z]{1,16}$/i.test(raw.method) ||
    typeof raw.startedAt !== 'number' ||
    !Number.isFinite(raw.startedAt)
  ) {
    return null;
  }

  const url = sanitizeNetworkUrl(resolvedUrl);
  const responseUrl = sanitizeNetworkUrl(raw.responseUrl || resolvedUrl);
  const documentUrl = sanitizeNetworkUrl(raw.documentUrl ?? resolvedUrl);
  if (!url || !responseUrl || !documentUrl) return null;
  const contentType = boundedString(raw.contentType, 256) ?? '';
  const requestBody = captureText(raw.requestBody?.value ?? null, {
    contentType,
    url: url.value,
  });
  const responseBody = captureText(raw.responseBody?.value ?? null, {
    contentType,
    url: responseUrl.value,
  });

  return {
    type: boundedString(raw.type, 64) ?? 'MENTORA_NETWORK_EVENT',
    phase: 'finish',
    requestId: raw.requestId,
    source: raw.source!,
    startedAt: raw.startedAt,
    finishedAt:
      typeof raw.finishedAt === 'number' && Number.isFinite(raw.finishedAt)
        ? raw.finishedAt
        : undefined,
    durationMs:
      typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
        ? Math.max(0, raw.durationMs)
        : undefined,
    documentUrl: documentUrl.value,
    method: raw.method.toUpperCase(),
    url: url.value,
    responseUrl: responseUrl.value,
    redirected: Boolean(raw.redirected),
    status:
      typeof raw.status === 'number' && Number.isInteger(raw.status)
        ? Math.min(599, Math.max(0, raw.status))
        : 0,
    statusText: boundedString(raw.statusText, NETWORK_TEXT_LIMIT),
    contentType,
    requestBody,
    responseBody,
    outcome: ['completed', 'failed', 'unknown'].includes(raw.outcome ?? '')
      ? raw.outcome
      : 'unknown',
    error: boundedString(raw.error, NETWORK_TEXT_LIMIT),
    urlRedactions: url.redactions,
    responseUrlRedactions: responseUrl.redactions,
    documentUrlRedactions: documentUrl.redactions,
  };
}

export function isValidNetworkCaptureStart(input: unknown): input is NetworkCaptureMessage {
  if (!input || typeof input !== 'object') return false;
  const raw = input as Partial<NetworkCaptureMessage>;
  return (
    raw.phase === 'start' &&
    ['fetch', 'xhr', 'beacon'].includes(raw.source ?? '') &&
    typeof raw.requestId === 'string' &&
    raw.requestId.length > 0 &&
    raw.requestId.length <= NETWORK_REQUEST_ID_LIMIT &&
    typeof raw.startedAt === 'number' &&
    Number.isFinite(raw.startedAt) &&
    typeof raw.method === 'string' &&
    /^[A-Z]{1,16}$/i.test(raw.method)
  );
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

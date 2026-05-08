/**
 * SOCIA Network Interceptor — MAIN world unlisted script.
 *
 * This file is compiled by WXT as an unlisted entrypoint and injected into
 * the page's MAIN JS context via injectScript() from the content script.
 * Because it's loaded as <script src="chrome-extension://…"> (not inline),
 * it bypasses any Content-Security-Policy on the target page.
 *
 * Communication: page context → window.postMessage → content script (isolated world)
 */

export default defineUnlistedScript(() => {
  const w = window as any;
  if (w.__sociaNetworkInterceptorInstalled) return;
  w.__sociaNetworkInterceptorInstalled = true;

  const MAX_BODY = 1000;
  const MSG_TYPE = 'SOCIA_NETWORK_EVENT';

  function trunc(s: string | null, m: number): string | null {
    if (!s) return null;
    return s.length <= m ? s : s.substring(0, m) + '...[truncated]';
  }

  function redact(b: string | null): string | null {
    if (!b) return null;
    return b
      .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"[REDACTED]"')
      .replace(/"passwd"\s*:\s*"[^"]*"/gi, '"passwd":"[REDACTED]"')
      .replace(/"secret"\s*:\s*"[^"]*"/gi, '"secret":"[REDACTED]"')
      .replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"[REDACTED]"')
      .replace(/"apikey"\s*:\s*"[^"]*"/gi, '"apikey":"[REDACTED]"')
      .replace(/"api_key"\s*:\s*"[^"]*"/gi, '"api_key":"[REDACTED]"');
  }

  function bodyStr(body: any): string | null {
    if (!body) return null;
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) {
      const parts: string[] = [];
      body.forEach((v, k) => {
        parts.push(k + '=' + (typeof v === 'string' ? v : '[File]'));
      });
      return parts.join('&');
    }
    return null;
  }

  function post(
    method: string,
    url: string,
    status: number,
    ct: string,
    reqBody: string | null,
    resBody: string | null
  ) {
    try {
      window.postMessage(
        {
          type: MSG_TYPE,
          method: method.toUpperCase(),
          url,
          status,
          contentType: ct,
          requestBody: redact(trunc(reqBody, MAX_BODY)),
          responseBody: trunc(resBody, MAX_BODY),
        },
        '*'
      );
    } catch (_e) {
      // silently ignore
    }
  }

  // --- Patch fetch ---
  const origFetch = window.fetch;
  window.fetch = function (input: any, init?: any) {
    const method = init?.method || 'GET';
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input?.url || '';
    const reqBody = bodyStr(init?.body);

    return origFetch.apply(this, arguments as any).then((response: Response) => {
      try {
        const clone = response.clone();
        const ct = clone.headers?.get('content-type') || '';
        if (
          ct.includes('application/json') ||
          ct.includes('text/') ||
          ct.includes('application/xml')
        ) {
          clone
            .text()
            .then((resBody: string) => post(method, url, clone.status, ct, reqBody, resBody))
            .catch(() => post(method, url, clone.status, ct, reqBody, null));
        } else {
          post(method, url, response.status, ct, reqBody, null);
        }
      } catch (_e) {
        post(method, url, response.status, '', reqBody, null);
      }
      return response;
    });
  };

  // --- Patch XMLHttpRequest ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: any, ...rest: any[]) {
    (this as any)._niMethod = method;
    (this as any)._niUrl = typeof url === 'string' ? url : url?.href || '';
    return origOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (body?: any) {
    const xhr = this as any;
    const method = xhr._niMethod || 'GET';
    const url = xhr._niUrl || '';
    const reqBody =
      body === null || body === undefined
        ? null
        : typeof body === 'string'
          ? body
          : body instanceof URLSearchParams
            ? body.toString()
            : null;

    xhr.addEventListener('load', function () {
      const ct = xhr.getResponseHeader('content-type') || '';
      let resBody: string | null = null;
      if (
        xhr.responseType === '' ||
        xhr.responseType === 'text' ||
        xhr.responseType === 'json'
      ) {
        resBody =
          typeof xhr.response === 'string'
            ? xhr.response
            : xhr.response
              ? JSON.stringify(xhr.response)
              : null;
      }
      post(method, url, xhr.status, ct, reqBody, resBody);
    });

    return origSend.apply(this, arguments as any);
  };

  console.log('[SOCIA] Network interceptor installed (unlisted script)');
});

/**
 * Injects a network interceptor into the page's MAIN world via a <script> tag.
 *
 * This is the reliable cross-browser method: the content script (isolated world)
 * injects a <script> into the page DOM. The script runs in the page's JS context
 * and patches fetch() / XMLHttpRequest to capture API request/response data.
 *
 * Communication flow:
 *   Page context (MAIN world) --[window.postMessage]--> Content script (isolated world) --[chrome.runtime.sendMessage]--> Background
 *
 * @param messageType - The postMessage type string (e.g. 'MENTORA_NETWORK_EVENT' or 'SOCIA_NETWORK_EVENT')
 */
export function injectNetworkInterceptor(messageType: string): void {
  const scriptContent = `
(function() {
  if (window.__networkInterceptorInstalled) return;
  window.__networkInterceptorInstalled = true;

  var MAX_BODY = 1000;
  var MSG_TYPE = ${JSON.stringify(messageType)};

  function trunc(s, m) {
    if (!s) return null;
    return s.length <= m ? s : s.substring(0, m) + '...[truncated]';
  }

  function redact(b) {
    if (!b) return null;
    return b
      .replace(/"password"\\s*:\\s*"[^"]*"/gi, '"password":"[REDACTED]"')
      .replace(/"passwd"\\s*:\\s*"[^"]*"/gi, '"passwd":"[REDACTED]"')
      .replace(/"secret"\\s*:\\s*"[^"]*"/gi, '"secret":"[REDACTED]"')
      .replace(/"token"\\s*:\\s*"[^"]*"/gi, '"token":"[REDACTED]"')
      .replace(/"apikey"\\s*:\\s*"[^"]*"/gi, '"apikey":"[REDACTED]"')
      .replace(/"api_key"\\s*:\\s*"[^"]*"/gi, '"api_key":"[REDACTED]"');
  }

  function bodyStr(body) {
    if (!body) return null;
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) {
      var p = [];
      body.forEach(function(v, k) { p.push(k + '=' + (typeof v === 'string' ? v : '[File]')); });
      return p.join('&');
    }
    return null;
  }

  function post(method, url, status, ct, reqBody, resBody) {
    try {
      window.postMessage({
        type: MSG_TYPE,
        method: method.toUpperCase(),
        url: url,
        status: status,
        contentType: ct,
        requestBody: redact(trunc(reqBody, MAX_BODY)),
        responseBody: trunc(resBody, MAX_BODY)
      }, '*');
    } catch(e) {}
  }

  // --- Patch fetch ---
  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    var method = (init && init.method) || 'GET';
    var url = typeof input === 'string' ? input
      : (input instanceof URL ? input.href
      : (input && input.url ? input.url : ''));
    var reqBody = bodyStr(init && init.body);

    return origFetch.apply(this, arguments).then(function(response) {
      try {
        var clone = response.clone();
        var ct = (clone.headers && clone.headers.get('content-type')) || '';
        if (ct.indexOf('application/json') >= 0 || ct.indexOf('text/') >= 0 || ct.indexOf('application/xml') >= 0) {
          clone.text().then(function(resBody) {
            post(method, url, clone.status, ct, reqBody, resBody);
          }).catch(function() {
            post(method, url, clone.status, ct, reqBody, null);
          });
        } else {
          post(method, url, response.status, ct, reqBody, null);
        }
      } catch(e) {
        post(method, url, response.status, '', reqBody, null);
      }
      return response;
    });
  };

  // --- Patch XMLHttpRequest ---
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._niMethod = method;
    this._niUrl = typeof url === 'string' ? url : (url && url.href ? url.href : '');
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    var xhr = this;
    var method = xhr._niMethod || 'GET';
    var url = xhr._niUrl || '';
    var reqBody = (body === null || body === undefined) ? null
      : (typeof body === 'string' ? body
      : (body instanceof URLSearchParams ? body.toString() : null));

    xhr.addEventListener('load', function() {
      var ct = xhr.getResponseHeader('content-type') || '';
      var resBody = null;
      if (xhr.responseType === '' || xhr.responseType === 'text' || xhr.responseType === 'json') {
        resBody = typeof xhr.response === 'string' ? xhr.response
          : (xhr.response ? JSON.stringify(xhr.response) : null);
      }
      post(method, url, xhr.status, ct, reqBody, resBody);
    });

    return origSend.apply(this, arguments);
  };

  console.log('[' + MSG_TYPE.split('_')[0] + '] Network interceptor installed');
})();
`;

  try {
    const script = document.createElement('script');
    script.textContent = scriptContent;
    (document.head || document.documentElement).appendChild(script);
    script.remove(); // Clean up — the code has already executed
  } catch (err) {
    console.error('[NetworkInterceptor] Failed to inject:', err);
  }
}

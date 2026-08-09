/**
 * SOCIA Content Script.
 * Records student actions (clicks, inputs, navigations, form submits)
 * AND relays network events from the MAIN world interceptor.
 * No evaluation logic — verification is done in background via network matching.
 */

import type { StudentAction } from '@socia/eval';
import { injectScript } from 'wxt/client';
import { createHintOverlay } from '@socia/runtime';
import {
  sanitizeNetworkCaptureMessage,
  shouldRelayNetworkCapture,
  type NetworkCaptureMessage,
} from '../../utils/shared/network-capture';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main() {
    console.log('[SOCIA Content] Recording on', window.location.href);

    // Inject the network interceptor into the page's MAIN JS context.
    // Uses <script src="chrome-extension://…"> which bypasses CSP (unlike inline scripts).
    injectScript('/interceptor-main.js', { keepInDom: true });

    // Notify background of navigation
    sendAction({ type: 'navigation', url: window.location.href, timestamp: Date.now() });

    // ──────────────── URL Tracking ────────────────

    let lastUrl = window.location.href;

    function onUrlChange() {
      const newUrl = window.location.href;
      if (newUrl === lastUrl) return;
      lastUrl = newUrl;
      sendAction({ type: 'navigation', url: newUrl, timestamp: Date.now() });
    }

    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function (...args) {
      const result = origPushState.apply(this, args);
      onUrlChange();
      return result;
    };
    history.replaceState = function (...args) {
      const result = origReplaceState.apply(this, args);
      onUrlChange();
      return result;
    };
    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);

    // ──────────────── Click Tracking ────────────────

    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement;
        if (!target) return;
        const elementText =
          target.innerText?.substring(0, 150) ||
          target.getAttribute('aria-label') ||
          target.getAttribute('title') ||
          '';
        sendAction({
          type: 'click',
          url: window.location.href,
          elementText,
          selector: safeSelector(target),
          timestamp: Date.now(),
        });
      },
      { capture: true }
    );

    // ──────────────── Input Tracking ────────────────

    const inputDebounce = new Map<Element, number>();

    document.addEventListener(
      'input',
      (event) => {
        const target = event.target as HTMLInputElement | HTMLTextAreaElement;
        if (!target) return;
        if (target instanceof HTMLInputElement && target.type === 'password') return;

        const existing = inputDebounce.get(target);
        if (existing) clearTimeout(existing);

        const timeout = window.setTimeout(() => {
          inputDebounce.delete(target);
          sendAction({
            type: 'input',
            url: window.location.href,
            selector: safeSelector(target),
            inputValue: target.value?.substring(0, 200) || '',
            timestamp: Date.now(),
          });
        }, 400);
        inputDebounce.set(target, timeout);
      },
      { capture: true }
    );

    // ──────────────── Form Submit Tracking ────────────────

    document.addEventListener(
      'submit',
      (event) => {
        const form = event.target as HTMLFormElement;
        sendAction({
          type: 'form_submit',
          url: window.location.href,
          selector: safeSelector(form),
          timestamp: Date.now(),
        });
      },
      { capture: true }
    );

    // ──────────────── Network Event Relay ────────────────
    // Listen for events from the MAIN world network interceptor

    function resolveUrl(raw: string): string {
      if (raw.startsWith('/') || (!raw.startsWith('http') && !raw.startsWith('//'))) {
        try {
          return new URL(raw, window.location.origin).href;
        } catch {
          return raw;
        }
      }
      return raw;
    }

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (!event.data || event.data.type !== 'SOCIA_NETWORK_EVENT') return;
      const message = event.data as NetworkCaptureMessage;
      if (message.phase !== 'finish') return;
      const url = resolveUrl(message.url);
      const sanitized = sanitizeNetworkCaptureMessage(
        {
          ...message,
          responseUrl: message.responseUrl
            ? resolveUrl(message.responseUrl)
            : url,
          documentUrl: resolveUrl(message.documentUrl),
        },
        url
      );
      if (!sanitized || !shouldRelayNetworkCapture(sanitized, sanitized.url)) return;

      // Parse URL for host and pathname
      let host = '';
      let pathname = '';
      try {
        const parsed = new URL(sanitized.url);
        host = parsed.host;
        pathname = parsed.pathname;
      } catch {
        return;
      }

      chrome.runtime
        .sendMessage({
          type: 'SOCIA_STUDENT_NETWORK_EVENT',
          networkEvent: {
            requestId: sanitized.requestId,
            timestamp: sanitized.startedAt,
            completedAt: sanitized.finishedAt,
            durationMs: sanitized.durationMs,
            source: sanitized.source,
            method: sanitized.method,
            url: sanitized.url,
            responseUrl: sanitized.responseUrl,
            redirected: sanitized.redirected ?? false,
            host,
            pathname,
            status: sanitized.status ?? 0,
            statusText: sanitized.statusText ?? '',
            contentType: sanitized.contentType ?? '',
            requestBody: sanitized.requestBody?.value ?? null,
            responseBody: sanitized.responseBody?.value ?? null,
            requestBodyLength: sanitized.requestBody?.originalLength ?? 0,
            responseBodyLength: sanitized.responseBody?.originalLength ?? 0,
            requestBodyTruncated: sanitized.requestBody?.truncated ?? false,
            responseBodyTruncated: sanitized.responseBody?.truncated ?? false,
            requestBodyRedactions: sanitized.requestBody?.redactions ?? [],
            responseBodyRedactions: sanitized.responseBody?.redactions ?? [],
            urlRedactions: sanitized.urlRedactions ?? [],
            responseUrlRedactions: sanitized.responseUrlRedactions ?? [],
            documentUrlRedactions: sanitized.documentUrlRedactions ?? [],
            outcome: sanitized.outcome,
            error: sanitized.error,
            documentUrl: sanitized.documentUrl,
          },
        })
        .catch(() => {});
    });

    // ──────────────── Floating hint overlay ────────────────
    // Show the FAB whenever a workflow is loaded — pistas disponibles en
    // ambos modos. Lo único que cambia entre guiado/no-guiado es la
    // visibilidad de los hitos en el popup, no las pistas.

    let overlayCreated = false;

    function maybeShowOverlay() {
      if (overlayCreated) return;
      chrome.runtime.sendMessage({ type: 'SOCIA_GET_STATE' }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp?.workflow && !overlayCreated) {
          overlayCreated = true;
          createHintOverlay();
        }
      });
    }

    // Check now and periodically (workflow may be loaded after page is open)
    maybeShowOverlay();
    const overlayPoll = setInterval(() => {
      if (overlayCreated) {
        clearInterval(overlayPoll);
        return;
      }
      maybeShowOverlay();
    }, 3000);

    // ──────────────── Utils ────────────────

    function sendAction(action: StudentAction) {
      chrome.runtime.sendMessage({ type: 'SOCIA_STUDENT_ACTION', action }).catch(() => {});
    }

    function safeSelector(el: HTMLElement): string {
      if (el.id) return `#${el.id}`;
      const tag = el.tagName?.toLowerCase() || 'unknown';
      const cls =
        el.className && typeof el.className === 'string'
          ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
          : '';
      return `${tag}${cls}`;
    }
  },
});

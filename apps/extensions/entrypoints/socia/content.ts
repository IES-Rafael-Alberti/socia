/**
 * SOCIA Content Script.
 * Records student actions (clicks, inputs, navigations, form submits)
 * AND relays network events from the MAIN world interceptor.
 * No evaluation logic — verification is done in background via network matching.
 */

import type { StudentAction } from '@socia/eval';
import { injectScript } from 'wxt/client';
import { createHintOverlay } from '@socia/runtime';

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

    // Content-types that indicate static resources (not API calls)
    const STATIC_CT = [
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

    function isStaticResource(ct: string): boolean {
      const lower = ct.toLowerCase();
      return STATIC_CT.some((prefix) => lower.includes(prefix));
    }

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

      const { method, status, contentType, requestBody, responseBody } = event.data;
      const url = resolveUrl(event.data.url);

      // Skip extension-internal requests
      if (url.startsWith('chrome-extension://')) return;

      // Skip static resources (CSS, JS, images, fonts, etc.)
      if (contentType && isStaticResource(contentType)) return;

      // For GETs without a content type or with binary content, skip (likely asset loads)
      if (method === 'GET' && (!contentType || contentType === 'application/binary')) return;

      // Parse URL for host and pathname
      let host = '';
      let pathname = '';
      try {
        const parsed = new URL(url);
        host = parsed.host;
        pathname = parsed.pathname;
      } catch {
        return;
      }

      chrome.runtime
        .sendMessage({
          type: 'SOCIA_STUDENT_NETWORK_EVENT',
          networkEvent: {
            timestamp: Date.now(),
            method,
            url,
            host,
            pathname,
            status,
            contentType: contentType || '',
            requestBody: requestBody || null,
            responseBody: responseBody || null,
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

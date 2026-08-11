/**
 * SOCIA Content Script.
 * Records student actions (clicks, inputs, navigations, form submits)
 * AND relays network events from the MAIN world interceptor.
 * No evaluation logic — verification is done in background via network matching.
 */

import type { StudentAction } from '@socia/eval';
import { injectScript } from 'wxt/client';
import {
  createHintOverlay,
  isExtensionContextInvalidatedError,
  sendRuntimeMessage,
} from '@socia/runtime';
import {
  sanitizeNetworkCaptureMessage,
  shouldRelayNetworkCapture,
  type NetworkCaptureMessage,
} from '../../utils/shared/network-capture';
import { getEventElement } from '../../utils/shared/event-target';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main(ctx) {
    const lifecycle = new AbortController();
    const { signal } = lifecycle;
    const intervalIds = new Set<number>();
    const inputDebounce = new Map<Element, number>();

    // WXT still detects newer copies of this content script. We only use its
    // abort event: its timer and listener wrappers read chrome.runtime.id and
    // Chrome throws when an old page keeps a script after an extension reload.
    ctx.onInvalidated(() => lifecycle.abort());

    signal.addEventListener(
      'abort',
      () => {
        for (const id of intervalIds) window.clearInterval(id);
        intervalIds.clear();
        for (const id of inputDebounce.values()) window.clearTimeout(id);
        inputDebounce.clear();
      },
      { once: true }
    );

    function handleRuntimeError(error: unknown) {
      if (isExtensionContextInvalidatedError(error)) lifecycle.abort();
    }

    function sendMessageSilently(message: unknown) {
      void sendRuntimeMessage(message).catch(handleRuntimeError);
    }

    function setLifecycleInterval(callback: () => void, delay: number): number {
      const id = window.setInterval(() => {
        if (!signal.aborted) callback();
      }, delay);
      intervalIds.add(id);
      return id;
    }

    console.log('[SOCIA Content] Recording on', window.location.href);

    // Inject the network interceptor into the page's MAIN JS context.
    // Uses <script src="chrome-extension://…"> which bypasses CSP (unlike inline scripts).
    void injectScript('/interceptor-main.js', { keepInDom: true }).catch(
      handleRuntimeError
    );

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

    window.addEventListener('popstate', onUrlChange, { signal });
    window.addEventListener('hashchange', onUrlChange, { signal });
    setLifecycleInterval(onUrlChange, 1000);

    // ──────────────── Click Tracking ────────────────

    document.addEventListener(
      'click',
      (event) => {
        const target = getEventElement(event);
        if (!target) return;
        const elementText =
          (target instanceof HTMLElement
            ? target.innerText?.substring(0, 150)
            : target.textContent?.substring(0, 150)) ||
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
      { capture: true, signal }
    );

    // ──────────────── Input Tracking ────────────────

    document.addEventListener(
      'input',
      (event) => {
        const target = getEventElement(event);
        if (
          !(target instanceof HTMLInputElement) &&
          !(target instanceof HTMLTextAreaElement) &&
          !(target instanceof HTMLSelectElement)
        ) {
          return;
        }
        if (target instanceof HTMLInputElement && target.type === 'password') return;

        const existing = inputDebounce.get(target);
        if (existing) clearTimeout(existing);

        const timeout = window.setTimeout(() => {
          if (signal.aborted) return;
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
      { capture: true, signal }
    );

    // ──────────────── Form Submit Tracking ────────────────

    document.addEventListener(
      'submit',
      (event) => {
        const form = getEventElement(event);
        if (!(form instanceof HTMLFormElement)) return;
        sendAction({
          type: 'form_submit',
          url: window.location.href,
          selector: safeSelector(form),
          timestamp: Date.now(),
        });
      },
      { capture: true, signal }
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

      sendMessageSilently({
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
      });
    }, { signal });

    // ──────────────── Floating hint overlay ────────────────
    // Show the FAB whenever a workflow is loaded — pistas disponibles en
    // ambos modos. Lo único que cambia entre guiado/no-guiado es la
    // visibilidad de los hitos en el popup, no las pistas.

    let overlayCreated = false;

    async function maybeShowOverlay() {
      if (overlayCreated || signal.aborted) return;
      try {
        const resp = await sendRuntimeMessage<{ workflow?: unknown }>({
          type: 'SOCIA_GET_STATE',
        });
        if (signal.aborted) return;
        if (resp?.workflow && !overlayCreated) {
          overlayCreated = true;
          createHintOverlay({ signal, onRuntimeError: handleRuntimeError });
        }
      } catch (error) {
        handleRuntimeError(error);
        // The background may be restarting or the extension may have reloaded.
      }
    }

    // Check now and periodically (workflow may be loaded after page is open)
    void maybeShowOverlay();
    const overlayPoll = setLifecycleInterval(() => {
      if (overlayCreated) {
        window.clearInterval(overlayPoll);
        intervalIds.delete(overlayPoll);
        return;
      }
      void maybeShowOverlay();
    }, 3000);

    // ──────────────── Utils ────────────────

    function sendAction(action: StudentAction) {
      sendMessageSilently({ type: 'SOCIA_STUDENT_ACTION', action });
    }

    function safeSelector(el: Element): string {
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

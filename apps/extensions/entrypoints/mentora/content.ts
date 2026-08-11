import { v4 as uuidv4 } from 'uuid';
import { getUniqueSelector, getElementText, getElementDescription } from '../../utils/mentora/selector';
import type { ActionLog, ActionType, RecordingState } from '../../utils/mentora/messages';
import {
  isSensitiveInputField,
  isValidNetworkCaptureStart,
  sanitizeNetworkCaptureMessage,
  shouldRelayNetworkCapture,
  type NetworkCaptureMessage,
} from '../../utils/shared/network-capture';
import { injectScript } from 'wxt/client';
import {
  NETWORK_PENDING_LIMIT,
  NETWORK_PENDING_TTL_MS,
  NETWORK_EVENTS_PER_MINUTE,
} from '../../utils/mentora/capture-limits';
import { getEventElement } from '../../utils/shared/event-target';

function sendMessage<T>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response as T);
    });
  });
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main() {
    // Inject the network interceptor into the page's MAIN JS context.
    // Uses <script src="chrome-extension://…"> which bypasses CSP (unlike inline scripts).
    injectScript('/interceptor-main.js', { keepInDom: true });
    let isRecording = false;
    let recordingStartTime: number | null = null;
    let lastScrollY = window.scrollY;
    let lastScrollX = window.scrollX;
    let scrollTimeout: number | null = null;
    let hoverTimeout: number | null = null;
    let hoveredElement: Element | null = null;
    const networkStarts = new Map<
      string,
      Promise<{ recordingId: string; relativeTime: number } | null>
    >();
    const networkRelayTimes: number[] = [];

    function canRelayNetworkStart(now = Date.now()): boolean {
      const cutoff = now - 60_000;
      while (networkRelayTimes[0] !== undefined && networkRelayTimes[0] <= cutoff) {
        networkRelayTimes.shift();
      }
      if (networkRelayTimes.length >= NETWORK_EVENTS_PER_MINUTE) return false;
      networkRelayTimes.push(now);
      return true;
    }

    // Get initial recording state
    sendMessage<{ state: RecordingState; startTime?: number }>({
      type: 'GET_RECORDING_STATE',
    })
      .then((response) => {
        if (response) {
          isRecording = response.state === 'recording';
          recordingStartTime = response.startTime ?? null;
        }
      })
      .catch(() => {
        // Ignore errors on startup
      });

    // Listen for recording state changes
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'RECORDING_STATE_CHANGED') {
        isRecording = message.state === 'recording';
        recordingStartTime = message.startTime || recordingStartTime;
        if (!isRecording) {
          networkStarts.clear();
          networkRelayTimes.length = 0;
        }
      }
    });

    function getRelativeTime(): number {
      if (!recordingStartTime) return 0;
      return (Date.now() - recordingStartTime) / 1000;
    }

    function logAction(
      type: ActionType,
      details: ActionLog['details'],
      humanReadable: string,
      needsScreenshot = false
    ): void {
      if (!isRecording) return;

      const action: ActionLog & { needsScreenshot?: boolean } = {
        id: `action_${uuidv4()}`,
        timestamp: Date.now(),
        relativeTime: getRelativeTime(),
        type,
        url: window.location.href,
        pageTitle: document.title,
        details,
        humanReadable,
        needsScreenshot,
      };

      sendMessage({ type: 'LOG_ACTION', action }).catch(() => {
        // Ignore send failures
      });
    }

    // Click handler
    document.addEventListener(
      'click',
      (event) => {
        if (!isRecording || !event.isTrusted) return;

        const target = getEventElement(event);
        if (!target) return;

        const element = {
          tagName: target.tagName,
          id: target.id || undefined,
          className:
            typeof target.className === 'string' ? target.className : undefined,
          text: getElementText(target),
          href: target instanceof HTMLAnchorElement ? target.href : undefined,
          selector: getUniqueSelector(target),
          ariaLabel: target.getAttribute('aria-label') || undefined,
        };

        const description = getElementDescription(target);

        logAction(
          'click',
          {
            element,
            position: { x: event.clientX, y: event.clientY },
          },
          `Clicked on ${description}`,
          true // Need screenshot for clicks
        );
      },
      { capture: true }
    );

    // Input handler (debounced)
    const inputDebounceMap = new Map<Element, number>();

    document.addEventListener(
      'input',
      (event) => {
        if (!isRecording || !event.isTrusted) return;

        const target = getEventElement(event);
        if (
          !(target instanceof HTMLInputElement) &&
          !(target instanceof HTMLTextAreaElement) &&
          !(target instanceof HTMLSelectElement)
        ) {
          return;
        }

        // Debounce inputs
        const existingTimeout = inputDebounceMap.get(target);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        const timeout = window.setTimeout(() => {
          inputDebounceMap.delete(target);

          const inputType =
            target instanceof HTMLInputElement
              ? target.type
              : target instanceof HTMLSelectElement
                ? 'select'
                : 'textarea';
          const sensitive = isSensitiveInputField({
            type: inputType,
            name: target.name,
            id: target.id,
            autocomplete: target.getAttribute('autocomplete') ?? undefined,
            value: target.value,
            url: window.location.href,
          });
          const value = sensitive ? '[REDACTED]' : target.value;

          logAction(
            'input',
            {
              element: {
                tagName: target.tagName,
                id: target.id || undefined,
                selector: getUniqueSelector(target),
              },
              inputType,
              inputName: target.name || undefined,
              inputValue: value,
            },
            `Typed '${value.substring(0, 80)}${value.length > 80 ? '...' : ''}' in ${getElementDescription(target)}`
          );
        }, 500);

        inputDebounceMap.set(target, timeout);
      },
      { capture: true }
    );

    // Scroll handler (debounced)
    document.addEventListener('scroll', (event) => {
      if (!isRecording || !event.isTrusted) return;

      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      scrollTimeout = window.setTimeout(() => {
        const deltaY = window.scrollY - lastScrollY;
        const deltaX = window.scrollX - lastScrollX;

        // Only log significant scrolls
        if (Math.abs(deltaY) < 100 && Math.abs(deltaX) < 100) {
          lastScrollY = window.scrollY;
          lastScrollX = window.scrollX;
          return;
        }

        let direction: 'up' | 'down' | 'left' | 'right' = 'down';
        if (Math.abs(deltaY) > Math.abs(deltaX)) {
          direction = deltaY > 0 ? 'down' : 'up';
        } else {
          direction = deltaX > 0 ? 'right' : 'left';
        }

        logAction(
          'scroll',
          {
            scrollY: window.scrollY,
            scrollX: window.scrollX,
            scrollDirection: direction,
          },
          `Scrolled ${direction} to position (${Math.round(window.scrollX)}, ${Math.round(window.scrollY)})`
        );

        lastScrollY = window.scrollY;
        lastScrollX = window.scrollX;
      }, 300);
    });

    // Text selection handler
    document.addEventListener('mouseup', (event) => {
      if (!isRecording || !event.isTrusted) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const selectedText = selection.toString().trim();
      if (selectedText.length === 0 || selectedText.length > 500) return;

      logAction(
        'select_text',
        {
          selectedText: selectedText.substring(0, 200),
        },
        `Selected text: '${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}'`
      );
    });

    // Copy handler
    document.addEventListener('copy', (event) => {
      if (!isRecording || !event.isTrusted) return;

      logAction('copy', {}, 'Copied content to clipboard');
    });

    // Paste handler
    document.addEventListener('paste', (event) => {
      if (!isRecording || !event.isTrusted) return;

      logAction('paste', {}, 'Pasted content from clipboard');
    });

    // Keypress handler for special keys
    document.addEventListener(
      'keydown',
      (event) => {
        if (!isRecording || !event.isTrusted) return;

        // Only log special keys and shortcuts
        const specialKeys = [
          'Enter',
          'Escape',
          'Tab',
          'Backspace',
          'Delete',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Home',
          'End',
          'PageUp',
          'PageDown',
        ];

        const isSpecialKey = specialKeys.includes(event.key);
        const hasModifier = event.ctrlKey || event.metaKey || event.altKey;

        if (!isSpecialKey && !hasModifier) return;

        // Skip if typing in an input
        const target = getEventElement(event);
        const isInput =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target?.getAttribute('contenteditable') === 'true';

        // For inputs, only log Enter and Escape
        if (isInput && !['Enter', 'Escape'].includes(event.key) && !hasModifier) {
          return;
        }

        const modifiers: string[] = [];
        if (event.ctrlKey) modifiers.push('Ctrl');
        if (event.metaKey) modifiers.push('Cmd');
        if (event.altKey) modifiers.push('Alt');
        if (event.shiftKey) modifiers.push('Shift');

        const keyCombo =
          modifiers.length > 0
            ? `${modifiers.join('+')}+${event.key}`
            : event.key;

        logAction(
          'keypress',
          {
            key: event.key,
            modifiers: modifiers.length > 0 ? modifiers : undefined,
          },
          `Pressed ${keyCombo}`
        );
      },
      { capture: true }
    );

    // Form submit handler
    document.addEventListener(
      'submit',
      (event) => {
        if (!isRecording || !event.isTrusted) return;

        const form = getEventElement(event);
        if (!(form instanceof HTMLFormElement)) return;

        logAction(
          'form_submit',
          {
            element: {
              tagName: 'FORM',
              id: form.id || undefined,
              selector: getUniqueSelector(form),
            },
          },
          `Submitted form${form.id ? ` #${form.id}` : ''}${form.action ? ` to ${new URL(form.action).pathname}` : ''}`
        );
      },
      { capture: true }
    );

    // Hover handler for elements with tooltips or dropdowns (>500ms)
    document.addEventListener(
      'mouseenter',
      (event) => {
        if (!isRecording || !event.isTrusted) return;

        const target = getEventElement(event);
        if (!target) return;

        // Only track hover on interactive elements
        const isInteractive =
          target instanceof HTMLButtonElement ||
          target instanceof HTMLAnchorElement ||
          target.getAttribute('role') === 'button' ||
          target.getAttribute('role') === 'menuitem' ||
          target.hasAttribute('data-tooltip') ||
          target.hasAttribute('title') ||
          target.classList.contains('dropdown') ||
          target.closest('[data-dropdown]');

        if (!isInteractive) return;

        if (hoverTimeout) {
          clearTimeout(hoverTimeout);
        }

        hoveredElement = target;

        hoverTimeout = window.setTimeout(() => {
          if (hoveredElement === target) {
            logAction(
              'hover',
              {
                element: {
                  tagName: target.tagName,
                  id: target.id || undefined,
                  selector: getUniqueSelector(target),
                  text: getElementText(target),
                },
              },
              `Hovered on ${getElementDescription(target)} for >500ms`
            );
          }
        }, 500);
      },
      { capture: true }
    );

    document.addEventListener(
      'mouseleave',
      (event) => {
        if (!event.isTrusted) return;
        const target = getEventElement(event);
        if (target === hoveredElement) {
          if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
          }
          hoveredElement = null;
        }
      },
      { capture: true }
    );

    // ─── Network event relay (from MAIN world interceptor) ───

    function resolveUrl(raw: string): string {
      // Resolve relative URLs against the page origin
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
      if (!event.data || event.data.type !== 'MENTORA_NETWORK_EVENT') return;
      const message = event.data as NetworkCaptureMessage;

      if (message.phase === 'start') {
        if (!isRecording) return;
        if (!isValidNetworkCaptureStart(message)) return;
        if (networkStarts.size >= NETWORK_PENDING_LIMIT) return;
        if (!canRelayNetworkStart()) return;
        const startPromise = sendMessage<{
          success: boolean;
          recordingId?: string;
          relativeTime?: number;
        }>({
          type: 'LOG_NETWORK_REQUEST_START',
          startedAt: message.startedAt,
        })
          .then((response) =>
            response.success && response.recordingId && response.relativeTime !== undefined
              ? {
                  recordingId: response.recordingId,
                  relativeTime: response.relativeTime,
                }
              : null
          )
          .catch(() => null);
        networkStarts.set(message.requestId, startPromise);
        window.setTimeout(() => {
          if (networkStarts.get(message.requestId) === startPromise) {
            networkStarts.delete(message.requestId);
          }
        }, NETWORK_PENDING_TTL_MS);
        return;
      }

      const startPromise = networkStarts.get(message.requestId);
      networkStarts.delete(message.requestId);
      if (!startPromise) return;

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

      void startPromise.then((start) => {
        if (!start) return;
        sendMessage({
          type: 'LOG_NETWORK_EVENT',
          recordingId: start.recordingId,
          relativeStartTime: start.relativeTime,
          networkEvent: sanitized,
        }).catch(() => {
          // Ignore send failures.
        });
      });
    });

    // Detect navigation via History API
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      if (isRecording) {
        logAction(
          'navigation',
          {
            fromUrl: document.referrer || undefined,
            toUrl: window.location.href,
            navigationType: 'link',
          },
          `Navigated to ${window.location.href}`
        );
      }
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      if (isRecording) {
        logAction(
          'navigation',
          {
            toUrl: window.location.href,
            navigationType: 'link',
          },
          `URL changed to ${window.location.href}`
        );
      }
      return result;
    };

    window.addEventListener('popstate', (event) => {
      if (!isRecording || !event.isTrusted) return;

      logAction(
        'navigation',
        {
          toUrl: window.location.href,
          navigationType: 'back',
        },
        `Navigated back/forward to ${window.location.href}`
      );
    });
  },
});

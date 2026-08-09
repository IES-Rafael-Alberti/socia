import type { ActionLog } from './messages';
import {
  isSensitiveInputField,
  redactNetworkSecrets,
  sanitizeNetworkUrl,
} from '../shared/network-capture';
import { ACTION_INPUT_VALUE_LIMIT, ACTION_TEXT_LIMIT } from './capture-limits';

export function sanitizeRecordedUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  return sanitizeNetworkUrl(value)?.value ?? '';
}

function sanitizeTextUrls(value: string): string {
  return redactNetworkSecrets(
    value.replace(/https?:\/\/[^\s'"<>]+/gi, (url) => sanitizeRecordedUrl(url) ?? '')
  );
}

function sanitizeText(value: string | undefined): string | undefined {
  return value === undefined
    ? undefined
    : sanitizeTextUrls(value).slice(0, ACTION_TEXT_LIMIT);
}

function boundedText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function sanitizeActionLog(action: ActionLog): ActionLog {
  const rawDetails =
    action.details && typeof action.details === 'object' ? action.details : {};
  const rawElement =
    rawDetails.element && typeof rawDetails.element === 'object'
      ? rawDetails.element
      : undefined;
  const details = {
    element: rawElement
      ? {
          tagName: boundedText(rawElement.tagName, 64) ?? '',
          id: sanitizeText(rawElement.id),
          className: sanitizeText(rawElement.className),
          text: sanitizeText(rawElement.text),
          href: sanitizeRecordedUrl(boundedText(rawElement.href, 16 * 1024)),
          selector: sanitizeText(rawElement.selector),
          ariaLabel: sanitizeText(rawElement.ariaLabel),
        }
      : undefined,
    position: rawDetails.position
      ? {
          x: finiteNumber(rawDetails.position.x) ?? 0,
          y: finiteNumber(rawDetails.position.y) ?? 0,
        }
      : undefined,
    inputType: boundedText(rawDetails.inputType, 64),
    inputName: boundedText(rawDetails.inputName, 256),
    inputValue: boundedText(rawDetails.inputValue, ACTION_INPUT_VALUE_LIMIT),
    scrollY: finiteNumber(rawDetails.scrollY),
    scrollX: finiteNumber(rawDetails.scrollX),
    scrollDirection: rawDetails.scrollDirection,
    selectedText: sanitizeText(rawDetails.selectedText),
    key: boundedText(rawDetails.key, 64),
    modifiers: Array.isArray(rawDetails.modifiers)
      ? rawDetails.modifiers.slice(0, 8).map((item) => String(item).slice(0, 32))
      : undefined,
    fromUrl: sanitizeRecordedUrl(boundedText(rawDetails.fromUrl, 16 * 1024)),
    toUrl: sanitizeRecordedUrl(boundedText(rawDetails.toUrl, 16 * 1024)),
    navigationType: rawDetails.navigationType,
    screenshotId: boundedText(rawDetails.screenshotId, 256),
    tabId: finiteNumber(rawDetails.tabId),
    tabTitle: sanitizeText(rawDetails.tabTitle),
  };
  const originalInput = details.inputValue;
  const inputIsSensitive =
    originalInput !== undefined &&
    isSensitiveInputField({
      type: details.inputType,
      name: details.inputName,
      id: details.element?.id,
      value: originalInput,
      url: action.url,
    });

  if (inputIsSensitive) details.inputValue = '[REDACTED]';
  else if (details.inputValue !== undefined) {
    details.inputValue = details.inputValue.slice(0, ACTION_INPUT_VALUE_LIMIT);
  }

  let humanReadable = sanitizeTextUrls(action.humanReadable);
  if (inputIsSensitive && originalInput) {
    humanReadable = humanReadable.split(originalInput).join('[REDACTED]');
  }

  return {
    id: boundedText(action.id, 128) ?? '',
    timestamp: finiteNumber(action.timestamp) ?? Date.now(),
    relativeTime: Math.max(0, finiteNumber(action.relativeTime) ?? 0),
    type: action.type,
    url: sanitizeRecordedUrl(boundedText(action.url, 16 * 1024)) ?? '',
    pageTitle: sanitizeText(boundedText(action.pageTitle, ACTION_TEXT_LIMIT)) ?? '',
    details,
    humanReadable: humanReadable.slice(0, ACTION_TEXT_LIMIT),
  };
}

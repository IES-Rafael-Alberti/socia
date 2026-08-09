import type { ActionLog } from './messages';
import {
  isSensitiveInputField,
  redactNetworkSecrets,
  sanitizeNetworkUrl,
} from '../shared/network-capture';

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
  return value === undefined ? undefined : sanitizeTextUrls(value);
}

export function sanitizeActionLog(action: ActionLog): ActionLog {
  const details = {
    ...action.details,
    element: action.details.element
      ? {
          ...action.details.element,
          id: sanitizeText(action.details.element.id),
          className: sanitizeText(action.details.element.className),
          text: sanitizeText(action.details.element.text),
          href: sanitizeRecordedUrl(action.details.element.href),
          selector: sanitizeText(action.details.element.selector),
          ariaLabel: sanitizeText(action.details.element.ariaLabel),
        }
      : undefined,
    fromUrl: sanitizeRecordedUrl(action.details.fromUrl),
    toUrl: sanitizeRecordedUrl(action.details.toUrl),
    selectedText: sanitizeText(action.details.selectedText),
    tabTitle: sanitizeText(action.details.tabTitle),
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

  let humanReadable = sanitizeTextUrls(action.humanReadable);
  if (inputIsSensitive && originalInput) {
    humanReadable = humanReadable.split(originalInput).join('[REDACTED]');
  }

  return {
    ...action,
    url: sanitizeRecordedUrl(action.url) ?? '',
    pageTitle: sanitizeTextUrls(action.pageTitle),
    details,
    humanReadable,
  };
}

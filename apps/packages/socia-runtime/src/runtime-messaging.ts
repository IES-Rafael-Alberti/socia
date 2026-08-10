/**
 * Sends a message to the extension runtime and turns synchronous Chrome errors
 * into Promise rejections. Chrome throws synchronously when a page keeps an old
 * content script after the extension has been reloaded.
 */
export function sendRuntimeMessage<TResponse>(message: unknown): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    const handleResponse = (response: TResponse) => {
      try {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(response);
      } catch (error) {
        reject(toError(error));
      }
    };

    try {
      chrome.runtime.sendMessage(message, handleResponse);
    } catch (error) {
      reject(toError(error));
    }
  });
}

/** Sends a message when no response is needed and consumes runtime errors. */
export function sendRuntimeMessageSilently(message: unknown): void {
  void sendRuntimeMessage(message).catch(() => {});
}

/** Returns true only for the error Chrome raises after an extension reload. */
export function isExtensionContextInvalidatedError(error: unknown): boolean {
  return /extension context invalidated/i.test(toError(error).message);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

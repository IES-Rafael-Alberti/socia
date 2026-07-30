const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
const VALIDATION_TIMEOUT_MS = 10_000;

export type OpenRouterValidationStatus =
  | 'valid'
  | 'invalid'
  | 'exhausted'
  | 'unavailable';

export interface OpenRouterValidationResult {
  status: OpenRouterValidationStatus;
  limitRemaining: number | null;
}

interface OpenRouterKeyResponse {
  data?: {
    limit_remaining?: number | null;
  };
}

export function isOpenRouterKeyFormatValid(apiKey: string): boolean {
  return apiKey.trim().startsWith('sk-');
}

export async function validateOpenRouterKey(
  apiKey: string,
  fetcher: typeof fetch = fetch
): Promise<OpenRouterValidationResult> {
  const trimmed = apiKey.trim();
  if (!isOpenRouterKeyFormatValid(trimmed)) {
    return { status: 'invalid', limitRemaining: null };
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

  try {
    const response = await fetcher(OPENROUTER_KEY_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${trimmed}`,
        'HTTP-Referer': 'https://socia-extension.local',
        'X-Title': 'MENTORA',
      },
      signal: controller.signal,
    });

    if (response.ok) {
      const body = (await response.json()) as OpenRouterKeyResponse;
      const limitRemaining =
        typeof body.data?.limit_remaining === 'number'
          ? body.data.limit_remaining
          : null;

      if (limitRemaining !== null && limitRemaining <= 0) {
        return { status: 'exhausted', limitRemaining };
      }
      return { status: 'valid', limitRemaining };
    }

    if (response.status === 401 || response.status === 403) {
      return { status: 'invalid', limitRemaining: null };
    }
    if (response.status === 402) {
      return { status: 'exhausted', limitRemaining: 0 };
    }
    return { status: 'unavailable', limitRemaining: null };
  } catch {
    return { status: 'unavailable', limitRemaining: null };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

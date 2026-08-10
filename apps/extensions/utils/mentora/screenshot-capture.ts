export const SCREENSHOT_CAPTURE_INTERVAL_MS = 550;

interface ScreenshotTab {
  active: boolean;
  url?: string;
}

export function canCaptureScreenshot(
  tab: ScreenshotTab,
  lastCaptureAt: number | null,
  now: number
): boolean {
  if (!tab.active || !isSupportedPageUrl(tab.url)) return false;
  return lastCaptureAt === null || now - lastCaptureAt >= SCREENSHOT_CAPTURE_INTERVAL_MS;
}

function isSupportedPageUrl(url?: string): boolean {
  if (!url) return false;

  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Types for messages between extension components

export type RecordingState = 'idle' | 'recording' | 'paused';

// Network event captured by the fetch/XHR interceptor
export interface NetworkEvent {
  id: string;
  /** Milliseconds since recording start */
  relativeTime: number;
  /** Absolute timestamp */
  timestamp: number;
  /** HTTP method (GET, POST, PATCH, DELETE, etc.) */
  method: string;
  /** Full URL */
  url: string;
  /** Response HTTP status code */
  status: number;
  /** Content-Type of the response */
  contentType: string;
  /** Truncated request body (max 1000 chars), passwords redacted */
  requestBody: string | null;
  /** Truncated response body (max 1000 chars) */
  responseBody: string | null;
  /** Host portion of the URL (e.g. "172.17.33.104:9000") */
  host: string;
  /** URL pathname (e.g. "/api/v1/case") */
  pathname: string;
  /** Stable identifier assigned when the page starts the request. */
  requestId?: string;
  /** Recording time when the response completed. */
  relativeEndTime?: number;
  /** Absolute time when the request completed. */
  completedAt?: number;
  /** Wall-clock request duration. */
  durationMs?: number;
  /** Browser API that initiated the request. */
  source?: 'fetch' | 'xhr' | 'beacon';
  /** Final response URL after redirects. */
  responseUrl?: string;
  redirected?: boolean;
  statusText?: string;
  requestBodyLength?: number;
  responseBodyLength?: number;
  requestBodyTruncated?: boolean;
  responseBodyTruncated?: boolean;
  outcome?: 'completed' | 'failed' | 'unknown';
  error?: string;
  tabId?: number;
  frameId?: number;
  documentUrl?: string;
}

// Action types captured by content script
export type ActionType =
  | 'click'
  | 'scroll'
  | 'input'
  | 'navigation'
  | 'tab_switch'
  | 'tab_create'
  | 'tab_close'
  | 'select_text'
  | 'copy'
  | 'paste'
  | 'keypress'
  | 'form_submit'
  | 'hover';

// Element details for click actions
export interface ElementDetails {
  tagName: string;
  id?: string;
  className?: string;
  text?: string;
  href?: string;
  selector?: string;
  ariaLabel?: string;
}

// Action log entry
export interface ActionLog {
  id: string;
  timestamp: number;
  relativeTime: number;
  type: ActionType;
  url: string;
  pageTitle: string;
  details: {
    element?: ElementDetails;
    position?: { x: number; y: number };
    inputType?: string;
    inputName?: string;
    inputValue?: string;
    scrollY?: number;
    scrollX?: number;
    scrollDirection?: 'up' | 'down' | 'left' | 'right';
    selectedText?: string;
    key?: string;
    modifiers?: string[];
    fromUrl?: string;
    toUrl?: string;
    navigationType?: 'link' | 'typed' | 'reload' | 'back' | 'forward';
    screenshotId?: string;
    tabId?: number;
    tabTitle?: string;
  };
  humanReadable: string;
}

// Screenshot data
export interface Screenshot {
  id: string;
  timestamp: number;
  relativeTime: number;
  dataUrl: string;
  actionId?: string;
}

// Recording session metadata
export interface RecordingMetadata {
  extensionName: string;
  version: string;
  recordingId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  totalActions: number;
  totalScreenshots: number;
  videoDuration?: string;
  pages: string[];
  /** Whether this recording may send audio to OpenRouter during export. */
  transcriptionEnabled?: boolean;
  /** Non-fatal capture problems that may leave the final seconds incomplete. */
  captureWarnings?: string[];
}

// Messages from popup to background
export type PopupToBackgroundMessage =
  | { type: 'START_RECORDING'; allowWithoutTranscription?: boolean }
  | { type: 'PAUSE_RECORDING' }
  | { type: 'RESUME_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'STOP_AND_DOWNLOAD' }
  | { type: 'GET_STATE' }
  | { type: 'VALIDATE_OPENROUTER_KEY'; apiKey: string }
  | { type: 'DOWNLOAD_RECORDING' };

// Messages from background to offscreen
export type BackgroundToOffscreenMessage =
  | { type: 'START_CAPTURE'; recordingId: string }
  | { type: 'PAUSE_CAPTURE' }
  | { type: 'RESUME_CAPTURE' }
  | { type: 'STOP_CAPTURE' }
  | { type: 'EXPORT_RECORDING'; recordingId: string; openRouterApiKey?: string }
  | { type: 'RELEASE_DOWNLOAD_URL' };

// Messages from offscreen to background
export type OffscreenToBackgroundMessage =
  | { type: 'CAPTURE_STARTED' }
  | { type: 'CAPTURE_PAUSED' }
  | { type: 'CAPTURE_RESUMED' }
  | { type: 'CAPTURE_STOPPED'; totalChunks: number }
  | { type: 'CAPTURE_ERROR'; error: string }
  | { type: 'EXPORT_STAGE_CHANGED'; stage: ExportStage };

// Messages from content script to background
export type ContentToBackgroundMessage =
  | { type: 'LOG_ACTION'; action: Omit<ActionLog, 'screenshotId'> & { needsScreenshot?: boolean } }
  | { type: 'GET_RECORDING_STATE' };

// Messages from background to content script
export type BackgroundToContentMessage =
  | { type: 'RECORDING_STATE_CHANGED'; state: RecordingState; startTime?: number }
  | { type: 'SCREENSHOT_TAKEN'; screenshotId: string; actionId: string };

// Response types
export interface StateResponse {
  state: RecordingState;
  startTime?: number;
  elapsedTime?: number;
  actionCount?: number;
  screenshotCount?: number;
  isPaused?: boolean;
  hasRecordingData?: boolean;
  /** True while a recording is being stopped or exported. */
  isExporting?: boolean;
  exportStage?: ExportStage;
}

export type ExportStage =
  | 'idle'
  | 'stopping'
  | 'preparing'
  | 'transcribing'
  | 'packaging'
  | 'downloading';

export type StartRecordingErrorCode =
  | 'OPENROUTER_INVALID'
  | 'OPENROUTER_EXHAUSTED'
  | 'OPENROUTER_UNAVAILABLE';

export interface StartRecordingResponse {
  success: boolean;
  error?: string;
  errorCode?: StartRecordingErrorCode;
  transcriptionEnabled?: boolean;
}

export interface DownloadResponse {
  success: boolean;
  error?: string;
}

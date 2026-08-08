import { v4 as uuidv4 } from 'uuid';
import {
  saveScreenshot,
  saveAction,
  saveMetadata,
  getMetadata,
  getLatestMetadata,
  getActionCount,
  getScreenshotCount,
  clearRecording,
  saveNetworkEvent,
} from '../../utils/mentora/db';
import {
  getRecordingState,
  startRecording as startRecordingState,
  pauseRecording as pauseRecordingState,
  resumeRecording as resumeRecordingState,
  stopRecording as stopRecordingState,
  getRelativeTime,
} from '../../utils/mentora/storage';
import type {
  ActionLog,
  ExportStage,
  NetworkEvent,
  Screenshot,
  StartRecordingResponse,
  StateResponse,
} from '../../utils/mentora/messages';
import { loadTranscriptionSettings } from '../../utils/mentora/transcription-settings';
import { validateOpenRouterKey } from '../../utils/mentora/openrouter-validation';
import type { NetworkCaptureMessage } from '../../utils/shared/network-capture';

interface MentoraRuntimeMessage {
  type: string;
  action?: ActionLog;
  networkEvent?: NetworkCaptureMessage;
  recordingId?: string;
  relativeStartTime?: number;
  startedAt?: number;
  target?: string;
  apiKey?: string;
  allowWithoutTranscription?: boolean;
  warnings?: string[];
  stage?: ExportStage;
}

export default defineBackground(() => {
  console.log('[Background] Service worker started');

  let currentRecordingId: string | null = null;
  let offscreenReady = false;
  const visitedPages = new Set<string>();
  let lastMicPermissionOpen = 0;
  let pendingStart = false;
  let startInProgress = false;
  let exportStage: ExportStage = 'idle';
  let currentRecordingTranscriptionEnabled = false;
  const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

  const initializationPromise = restoreBackgroundState();

  // Handle messages from popup, content scripts, and offscreen
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] Received message:', message.type, 'from:', sender.url || sender.id || 'unknown');
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error('[Background] Error handling message:', error);
        sendResponse({ success: false, error: String(error) });
      });
    return true; // Keep channel open for async response
  });

  async function handleMessage(
    message: MentoraRuntimeMessage,
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    await initializationPromise;
    if (sender.url?.includes('offscreen.html') && message.target !== 'background') {
      return { success: false, error: 'Ignored non-background message' };
    }

    const state = await getRecordingState();

    switch (message.type) {
      // Popup messages
      case 'START_RECORDING':
        return await startRecording(message.allowWithoutTranscription);
      case 'PAUSE_RECORDING':
        return await pauseRecording();
      case 'RESUME_RECORDING':
        return await resumeRecording();
      case 'STOP_RECORDING':
        return await stopRecording();
      case 'STOP_AND_DOWNLOAD':
        return await stopAndDownload();
      case 'GET_STATE':
        return await getState();
      case 'VALIDATE_OPENROUTER_KEY':
        return await validateOpenRouterKey(message.apiKey ?? '');
      case 'DOWNLOAD_RECORDING':
        return await downloadRecording();

      // Content script messages
      case 'LOG_ACTION':
        if (state.state === 'recording' && message.action) {
          return await logAction(message.action, sender.tab?.id);
        }
        return { success: false };
      case 'LOG_NETWORK_REQUEST_START':
        if (state.state === 'recording' && state.recordingId) {
          return {
            success: true,
            recordingId: state.recordingId,
            relativeTime: await getRelativeTime(),
          };
        }
        return { success: false };
      case 'LOG_NETWORK_EVENT':
        if (
          message.networkEvent &&
          message.recordingId &&
          message.relativeStartTime !== undefined &&
          (message.recordingId === state.recordingId ||
            message.recordingId === currentRecordingId)
        ) {
          return await logNetworkEvent(
            message.networkEvent,
            message.recordingId,
            message.relativeStartTime,
            sender,
            state.recordingId === message.recordingId
              ? await getRelativeTime()
              : message.relativeStartTime +
                (message.networkEvent.durationMs ?? 0) / 1000
          );
        }
        return { success: false };
      case 'GET_RECORDING_STATE':
        return {
          state: state.state,
          startTime: state.startTime,
        };

      // Offscreen messages
      case 'OFFSCREEN_READY':
        console.log('[Background] Offscreen document ready');
        offscreenReady = true;
        return { success: true };
      case 'EXPORT_STAGE_CHANGED':
        if (message.stage) await updateExportStage(message.stage);
        return { success: true };
      case 'CAPTURE_STARTED':
        console.log('[Background] Capture started confirmed');
        await ensureRecordingState();
        await updateBadge('recording');
        return { success: true };
      case 'CAPTURE_PAUSED':
        console.log('[Background] Capture paused confirmed');
        await updateBadge('paused');
        return { success: true };
      case 'CAPTURE_RESUMED':
        console.log('[Background] Capture resumed confirmed');
        await updateBadge('recording');
        return { success: true };
      case 'CAPTURE_STOPPED':
        console.log('[Background] Capture stopped confirmed');
        await updateBadge('idle');
        return { success: true };
      case 'CAPTURE_STOPPED_BY_USER':
        console.log('[Background] User stopped sharing');
        await handleUserStoppedSharing();
        return { success: true };
      case 'CAPTURE_ERROR':
        console.error('[Background] Capture error:', message);
        if (currentRecordingId) await finalizeInterruptedRecording(currentRecordingId);
        await stopRecordingState(currentRecordingId);
        await updateBadge('idle');
        offscreenReady = false;
        return { success: false };
      case 'MIC_PERMISSION_NEEDED':
        await openMicPermissionPage();
        return { success: true };
      case 'MIC_PERMISSION_GRANTED':
        if (pendingStart && !startInProgress) {
          await startRecording(false, currentRecordingTranscriptionEnabled);
        }
        return { success: true };

      default:
        console.log('[Background] Unknown message type:', message.type);
        return { error: 'Unknown message type' };
    }
  }

  async function restoreBackgroundState(): Promise<void> {
    const storedStage = await chrome.storage.session
      .get('mentoraExportStage')
      .then((value) => value.mentoraExportStage as ExportStage | undefined)
      .catch(() => undefined);
    const state = await getRecordingState();
    const hasOffscreen = await checkOffscreenExists();

    exportStage = storedStage && hasOffscreen ? storedStage : 'idle';
    if (exportStage === 'idle' && storedStage && storedStage !== 'idle') {
      await chrome.storage.session.set({ mentoraExportStage: 'idle' }).catch(() => undefined);
    }

    if (state.recordingId) {
      currentRecordingId = state.recordingId;
    } else {
      const latest = await getLatestMetadata();
      if (latest) {
        currentRecordingId = latest.recordingId;
        await stopRecordingState(latest.recordingId);
      }
    }

    if (state.recordingId && state.state !== 'idle') {
      console.log('[Background] Restored recording state:', state.state);
      if (!hasOffscreen) {
        console.log('[Background] Capture context lost; preserving recorded chunks');
        await finalizeInterruptedRecording(state.recordingId);
        await stopRecordingState(state.recordingId);
        await updateBadge('idle');
      } else {
        await updateBadge(state.state === 'paused' ? 'paused' : 'recording');
      }
    }
  }

  async function finalizeInterruptedRecording(recordingId: string): Promise<void> {
    const metadata = await getMetadata(recordingId);
    if (!metadata) return;
    const endedAt = Date.now();
    await saveMetadata({
      ...metadata,
      endTime: metadata.endTime ?? endedAt,
      duration: metadata.duration ?? Math.max(0, endedAt - metadata.startTime),
      totalActions: await getActionCount(recordingId),
      totalScreenshots: await getScreenshotCount(recordingId),
      captureWarnings: [
        ...(metadata.captureWarnings ?? []),
        'The capture context restarted before the recording closed.',
      ],
    });
  }

  async function updateExportStage(stage: ExportStage): Promise<void> {
    exportStage = stage;
    await chrome.storage.session.set({ mentoraExportStage: stage }).catch(() => undefined);
  }

  async function startRecording(
    allowWithoutTranscription = false,
    validatedTranscriptionEnabled?: boolean
  ): Promise<StartRecordingResponse> {
    if (startInProgress) {
      return { success: false, error: 'Start already in progress' };
    }

    let transcriptionEnabled = validatedTranscriptionEnabled ?? false;
    if (validatedTranscriptionEnabled === undefined && !allowWithoutTranscription) {
      const settings = await loadTranscriptionSettings();
      if (settings.openRouterApiKey) {
        const validation = await validateOpenRouterKey(settings.openRouterApiKey);
        if (validation.status === 'invalid') {
          return {
            success: false,
            error: 'OpenRouter API key is invalid',
            errorCode: 'OPENROUTER_INVALID',
          };
        }
        if (validation.status === 'exhausted') {
          return {
            success: false,
            error: 'OpenRouter API key has no remaining limit',
            errorCode: 'OPENROUTER_EXHAUSTED',
          };
        }
        if (validation.status === 'unavailable') {
          return {
            success: false,
            error: 'OpenRouter key validation is unavailable',
            errorCode: 'OPENROUTER_UNAVAILABLE',
          };
        }
        transcriptionEnabled = true;
      }
    }

    try {
      startInProgress = true;
      pendingStart = true;
      currentRecordingTranscriptionEnabled = transcriptionEnabled;
      console.log('[Background] Starting recording...');

      // Clear any leftover data from a previous (already-downloaded) session
      // so the new recording starts on a clean slate.
      const prevState = await getRecordingState();
      const prevRecordingId = prevState.recordingId ?? currentRecordingId;
      if (prevRecordingId) {
        await clearRecording(prevRecordingId);
      }

      currentRecordingId = uuidv4();
      visitedPages.clear();
      offscreenReady = false;

      // Create offscreen document
      await ensureOffscreenDocument();

      // Wait for offscreen to be ready
      const isReady = await waitForOffscreenReady(7000);
      if (!isReady) {
        console.error('[Background] Offscreen not ready after waiting');
        await closeOffscreenDocument();
        await stopRecordingState(null);
        currentRecordingId = null;
        currentRecordingTranscriptionEnabled = false;
        pendingStart = false;
        startInProgress = false;
        return { success: false, error: 'Offscreen document not ready' };
      }

      // Start capture in offscreen document
      console.log('[Background] Sending START_CAPTURE to offscreen...');
      const response = await sendToOffscreen({
        type: 'START_CAPTURE',
        recordingId: currentRecordingId,
      });
      console.log('[Background] Start capture response:', response);

      if (!response?.success) {
        // User cancelled or error
        currentRecordingId = null;
        startInProgress = false;
        if (response?.error === 'MIC_PERMISSION_REQUIRED') {
          await openMicPermissionPage();
          return { success: false, error: 'Microphone permission required' };
        }
        currentRecordingTranscriptionEnabled = false;
        pendingStart = false;
        await stopRecordingState(null);
        await closeOffscreenDocument();
        return { success: false, error: response?.error || 'User cancelled screen sharing' };
      }

      // Update state after capture begins
      await ensureRecordingState();

      // Get active tab for tracking
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        visitedPages.add(tab.url);
      }

      // Notify all tabs that recording started
      await notifyAllTabs('RECORDING_STATE_CHANGED', {
        state: 'recording',
        startTime: Date.now(),
      });

      console.log('[Background] Recording started successfully');
      pendingStart = false;
      startInProgress = false;
      return { success: true, transcriptionEnabled };
    } catch (error) {
      console.error('[Background] Failed to start recording:', error);
      await stopRecordingState(null);
      currentRecordingId = null;
      currentRecordingTranscriptionEnabled = false;
      pendingStart = false;
      await closeOffscreenDocument();
      startInProgress = false;
      return { success: false, error: String(error) };
    }
  }

  async function pauseRecording(): Promise<{ success: boolean }> {
    console.log('[Background] Pausing recording...');
    try {
      const hasOffscreen = await checkOffscreenExists();
      if (hasOffscreen) {
        const response = await sendToOffscreen({ type: 'PAUSE_CAPTURE' });
        console.log('[Background] Pause response from offscreen:', response);
      }
      await pauseRecordingState();
      await notifyAllTabs('RECORDING_STATE_CHANGED', { state: 'paused' });
      await updateBadge('paused');
      return { success: true };
    } catch (error) {
      console.error('[Background] Failed to pause:', error);
      return { success: false };
    }
  }

  async function resumeRecording(): Promise<{ success: boolean }> {
    console.log('[Background] Resuming recording...');
    try {
      const hasOffscreen = await checkOffscreenExists();
      if (hasOffscreen) {
        const response = await sendToOffscreen({ type: 'RESUME_CAPTURE' });
        console.log('[Background] Resume response from offscreen:', response);
      }
      await resumeRecordingState();
      await notifyAllTabs('RECORDING_STATE_CHANGED', { state: 'recording' });
      await updateBadge('recording');
      return { success: true };
    } catch (error) {
      console.error('[Background] Failed to resume:', error);
      return { success: false };
    }
  }

  async function stopRecording(
    keepOffscreenOpen = false
  ): Promise<{ success: boolean; error?: string }> {
    console.log('[Background] Stopping recording...');

    const recordingIdToStop = currentRecordingId;

    if (!recordingIdToStop) {
      // Try to get from storage
      const state = await getRecordingState();
      if (!state.recordingId) {
        return { success: false };
      }
    }

    let captureWarnings: string[] = [];
    let captureContextUsable = true;
    try {
      // Stop capture
      const hasOffscreen = await checkOffscreenExists();
      if (hasOffscreen) {
        const response = await sendToOffscreen({ type: 'STOP_CAPTURE' }, 35_000);
        console.log('[Background] Stop response from offscreen:', response);
        if (!response.success) {
          captureContextUsable = false;
          captureWarnings.push(
            response.error ?? 'The capture context did not finish cleanly.'
          );
          await closeOffscreenDocument();
        } else {
          captureWarnings = response.warnings ?? [];
        }
      }
    } catch (error) {
      console.log('[Background] Error stopping capture (may already be stopped):', error);
      captureContextUsable = false;
      captureWarnings.push('The capture context failed while stopping.');
    }

    // Update metadata
    const state = await getRecordingState();
    const recordingId = recordingIdToStop || state.recordingId;

    if (recordingId) {
      const metadata = await getMetadata(recordingId);
      if (metadata) {
        const actionCount = await getActionCount(recordingId);
        const screenshotCount = await getScreenshotCount(recordingId);
        await saveMetadata({
          ...metadata,
          endTime: Date.now(),
          duration: Date.now() - metadata.startTime,
          totalActions: actionCount,
          totalScreenshots: screenshotCount,
          pages: Array.from(visitedPages),
          captureWarnings: [
            ...(metadata.captureWarnings ?? []),
            ...captureWarnings,
          ],
        });
      }
    }

    await stopRecordingState(recordingId);
    await notifyAllTabs('RECORDING_STATE_CHANGED', { state: 'idle' });
    if (!keepOffscreenOpen || !captureContextUsable) await closeOffscreenDocument();
    await closeMicPermissionTab();
    await updateBadge('idle');
    if (!keepOffscreenOpen || !captureContextUsable) offscreenReady = false;

    // Don't clear currentRecordingId so we can still download
    console.log('[Background] Recording stopped');
    return { success: true };
  }

  async function handleUserStoppedSharing(): Promise<void> {
    console.log('[Background] Handling user stopped sharing...');
    await stopRecording();
  }

  async function getState(): Promise<StateResponse> {
    const state = await getRecordingState();
    let actionCount = 0;
    let screenshotCount = 0;

    const recordingId = state.recordingId || currentRecordingId;
    if (recordingId) {
      actionCount = await getActionCount(recordingId);
      screenshotCount = await getScreenshotCount(recordingId);
    }

    const relativeTime = await getRelativeTime();
    const hasRecordingData = !!recordingId;

    const response: StateResponse = {
      state: state.state,
      startTime: state.startTime ?? undefined,
      elapsedTime: relativeTime * 1000,
      actionCount,
      screenshotCount,
      isPaused: state.state === 'paused',
      hasRecordingData,
      isExporting: exportStage !== 'idle',
      exportStage,
    };
    console.log('[Background] GET_STATE response:', response);
    return response;
  }

  async function logAction(
    action: ActionLog & { needsScreenshot?: boolean },
    tabId?: number
  ): Promise<{ success: boolean; screenshotId?: string }> {
    const recordingId = currentRecordingId || (await getRecordingState()).recordingId;
    if (!recordingId) {
      return { success: false };
    }

    const relativeTime = await getRelativeTime();
    const actionWithTime: ActionLog = {
      ...action,
      relativeTime,
    };

    // Track visited pages
    if (action.url) {
      visitedPages.add(action.url);
    }

    // Take screenshot if needed (for clicks)
    let screenshotId: string | undefined;
    if (action.needsScreenshot && tabId) {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
        screenshotId = `screenshot_${Date.now()}.png`;

        const screenshot: Screenshot = {
          id: screenshotId,
          timestamp: Date.now(),
          relativeTime,
          dataUrl,
          actionId: action.id,
        };

        await saveScreenshot(recordingId, screenshot);
        actionWithTime.details.screenshotId = screenshotId;
      } catch (error) {
        console.error('[Background] Failed to capture screenshot:', error);
      }
    }

    // Save action
    await saveAction(recordingId, actionWithTime);

    return { success: true, screenshotId };
  }

  async function logNetworkEvent(
    raw: NetworkCaptureMessage,
    recordingId: string,
    relativeStartTime: number,
    sender: chrome.runtime.MessageSender,
    relativeEndTime: number
  ): Promise<{ success: boolean }> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(raw.url);
    } catch {
      // Relative URL — try to reconstruct
      try {
        parsedUrl = new URL(raw.url, 'https://localhost');
      } catch {
        return { success: false };
      }
    }

    const event: NetworkEvent = {
      id: raw.requestId,
      requestId: raw.requestId,
      relativeTime: relativeStartTime,
      relativeEndTime,
      timestamp: raw.startedAt,
      completedAt: raw.finishedAt,
      durationMs: raw.durationMs,
      source: raw.source,
      method: raw.method,
      url: raw.url,
      responseUrl: raw.responseUrl,
      redirected: raw.redirected,
      status: raw.status ?? 0,
      statusText: raw.statusText,
      contentType: raw.contentType ?? '',
      requestBody: raw.requestBody?.value ?? null,
      responseBody: raw.responseBody?.value ?? null,
      requestBodyLength: raw.requestBody?.originalLength ?? 0,
      responseBodyLength: raw.responseBody?.originalLength ?? 0,
      requestBodyTruncated: raw.requestBody?.truncated ?? false,
      responseBodyTruncated: raw.responseBody?.truncated ?? false,
      outcome: raw.outcome,
      error: raw.error,
      host: parsedUrl.host,
      pathname: parsedUrl.pathname,
      tabId: sender.tab?.id,
      frameId: sender.frameId,
      documentUrl: raw.documentUrl,
    };

    await saveNetworkEvent(recordingId, event);
    console.log(`[Background] Network event saved: ${raw.method} ${parsedUrl.pathname} → ${raw.status}`);
    return { success: true };
  }

  async function stopAndDownload(): Promise<{ success: boolean; error?: string }> {
    if (exportStage !== 'idle') {
      return { success: false, error: 'Export already in progress' };
    }
    await updateExportStage('stopping');
    try {
      const stopResponse = await stopRecording(true);
      if (!stopResponse.success) {
        await updateExportStage('idle');
        return stopResponse;
      }
      return await downloadRecording(true);
    } catch (error) {
      await updateExportStage('idle');
      return { success: false, error: String(error) };
    }
  }

  async function downloadRecording(
    continueExport = false
  ): Promise<{ success: boolean; error?: string }> {
    if (!continueExport && exportStage !== 'idle') {
      return { success: false, error: 'Export already in progress' };
    }
    const state = await getRecordingState();
    const recordingId = currentRecordingId || state.recordingId;

    if (!recordingId) {
      await updateExportStage('idle');
      return { success: false, error: 'No recording available' };
    }

    await updateExportStage('preparing');
    let hasDownloadUrl = false;
    try {
      await ensureOffscreenDocument();
      if (!(await waitForOffscreenReady(7000))) {
        return { success: false, error: 'Export context is not ready' };
      }
      const metadata = await getMetadata(recordingId);
      if (!metadata) return { success: false, error: 'Recording metadata not found' };
      const settings = await loadTranscriptionSettings();
      const transcriptionEnabled =
        metadata.transcriptionEnabled ?? Boolean(settings.openRouterApiKey);
      const response = await sendToOffscreen(
        {
          type: 'EXPORT_RECORDING',
          recordingId,
          openRouterApiKey: transcriptionEnabled
            ? settings.openRouterApiKey ?? undefined
            : undefined,
        },
        60 * 60 * 1000
      );
      if (!response.success || !response.downloadUrl || !response.filename) {
        return {
          success: false,
          error: response.error ?? 'Export did not create a download',
        };
      }

      hasDownloadUrl = true;
      await updateExportStage('downloading');
      const downloadId = await chrome.downloads.download({
        url: response.downloadUrl,
        filename: response.filename,
        saveAs: true,
      });
      await waitForDownload(downloadId);
      return { success: true };
    } catch (error) {
      console.error('[Background] Failed to download recording:', error);
      return { success: false, error: String(error) };
    } finally {
      if (hasDownloadUrl) {
        await sendToOffscreen({ type: 'RELEASE_DOWNLOAD_URL' }).catch(() => undefined);
      }
      await updateExportStage('idle');
      await closeOffscreenDocument();
    }
  }

  async function checkOffscreenExists(): Promise<boolean> {
    try {
      if (!chrome.runtime.getContexts) {
        return offscreenReady;
      }
      const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      });
      return contexts.length > 0;
    } catch {
      return offscreenReady;
    }
  }

  async function ensureOffscreenDocument(): Promise<void> {
    try {
      const exists = await checkOffscreenExists();

      if (!exists) {
        console.log('[Background] Creating offscreen document...');
        offscreenReady = false;
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: [
            chrome.offscreen.Reason.USER_MEDIA,
            chrome.offscreen.Reason.DISPLAY_MEDIA,
            chrome.offscreen.Reason.BLOBS,
          ],
          justification: 'Capture media and prepare recording downloads',
        });
        console.log('[Background] Offscreen document created');
      } else {
        console.log('[Background] Offscreen document already exists');
        offscreenReady = true;
      }
    } catch (error) {
      console.error('[Background] Error creating offscreen document:', error);
      throw error;
    }
  }

  async function closeOffscreenDocument(): Promise<void> {
    try {
      const exists = await checkOffscreenExists();
      if (exists) {
        await chrome.offscreen.closeDocument();
        console.log('[Background] Offscreen document closed');
      }
    } catch {
      // Document might already be closed
    }
    offscreenReady = false;
  }

  async function waitForOffscreenReady(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (!offscreenReady && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return offscreenReady;
  }

  async function sendToOffscreen(message: {
    type: string;
    recordingId?: string;
    openRouterApiKey?: string;
  }, timeoutMs = 30_000): Promise<{
    success: boolean;
    error?: string;
    warnings?: string[];
    downloadUrl?: string;
    filename?: string;
  }> {
    // Send message and wait for response
    return new Promise((resolve) => {
      let settled = false;
      const timeout = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ success: false, error: `${message.type} timed out` });
      }, timeoutMs);
      chrome.runtime.sendMessage({ ...message, target: 'offscreen' }, (response) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          console.error('[Background] Error sending to offscreen:', chrome.runtime.lastError);
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: 'No response' });
        }
      });
    });
  }

  function waitForDownload(downloadId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        cleanupListener();
        reject(new Error('Download did not finish in time'));
      }, DOWNLOAD_TIMEOUT_MS);

      const handleChanged = (delta: chrome.downloads.DownloadDelta) => {
        if (delta.id !== downloadId) return;
        if (delta.error?.current) {
          cleanupListener();
          reject(new Error(delta.error.current));
        } else if (delta.state?.current === 'complete') {
          cleanupListener();
          resolve();
        }
      };

      const cleanupListener = () => {
        globalThis.clearTimeout(timeout);
        chrome.downloads.onChanged.removeListener(handleChanged);
      };

      chrome.downloads.onChanged.addListener(handleChanged);
      chrome.downloads.search({ id: downloadId }).then(([item]) => {
        if (item?.state === 'complete') {
          cleanupListener();
          resolve();
        }
      }).catch(() => {
        // The change listener remains authoritative.
      });
    });
  }

  async function notifyAllTabs(
    type: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type, ...data });
        } catch {
          // Tab might not have content script
        }
      }
    }
  }

  async function updateBadge(state: 'recording' | 'paused' | 'idle'): Promise<void> {
    switch (state) {
      case 'recording':
        await chrome.action.setBadgeText({ text: '●' });
        await chrome.action.setBadgeBackgroundColor({ color: '#e93456' });
        break;
      case 'paused':
        await chrome.action.setBadgeText({ text: '❚❚' });
        await chrome.action.setBadgeBackgroundColor({ color: '#222220' });
        break;
      case 'idle':
        await chrome.action.setBadgeText({ text: '' });
        break;
    }
  }

  let micPermissionTabId: number | null = null;

  async function openMicPermissionPage(): Promise<void> {
    const now = Date.now();
    if (now - lastMicPermissionOpen < 5000) {
      return;
    }
    lastMicPermissionOpen = now;
    const url = chrome.runtime.getURL('mic-permission.html');
    const tab = await chrome.tabs.create({ url });
    micPermissionTabId = tab.id ?? null;
  }

  async function closeMicPermissionTab(): Promise<void> {
    // Send message to the mic tab so it releases the stream before closing
    try {
      if (micPermissionTabId) {
        await chrome.tabs.sendMessage(micPermissionTabId, { type: 'CLOSE_MIC_TAB' });
      }
    } catch {
      // Tab might already be closed
    }
    // Also try to close it directly in case the message didn't work
    try {
      if (micPermissionTabId) {
        await chrome.tabs.remove(micPermissionTabId);
      }
    } catch {
      // Already closed
    }
    micPermissionTabId = null;
  }


  async function ensureRecordingState(): Promise<void> {
    if (!currentRecordingId) {
      return;
    }

    const existingState = await getRecordingState();
    if (existingState.state !== 'recording') {
      await startRecordingState(currentRecordingId);
      await notifyAllTabs('RECORDING_STATE_CHANGED', {
        state: 'recording',
        startTime: Date.now(),
      });
    }

    const metadata = await getMetadata(currentRecordingId);
    if (!metadata) {
      await saveMetadata({
        extensionName: 'MENTORA',
        version: '1.0.0',
        recordingId: currentRecordingId,
        startTime: Date.now(),
        totalActions: 0,
        totalScreenshots: 0,
        pages: [],
        transcriptionEnabled: currentRecordingTranscriptionEnabled,
      });
    }
  }

  // Listen for tab changes to log navigation
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const state = await getRecordingState();
    if (state.state !== 'recording') return;

    const recordingId = currentRecordingId || state.recordingId;
    if (!recordingId) return;

    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      const relativeTime = await getRelativeTime();

      const action: ActionLog = {
        id: `action_${Date.now()}`,
        timestamp: Date.now(),
        relativeTime,
        type: 'tab_switch',
        url: tab.url || '',
        pageTitle: tab.title || '',
        details: {
          tabId: activeInfo.tabId,
          tabTitle: tab.title,
        },
        humanReadable: `Switched to tab: '${tab.title}'`,
      };

      await saveAction(recordingId, action);

      if (tab.url) {
        visitedPages.add(tab.url);
      }
    } catch (error) {
      console.error('[Background] Error logging tab switch:', error);
    }
  });

  // Listen for new tabs
  chrome.tabs.onCreated.addListener(async (tab) => {
    const state = await getRecordingState();
    if (state.state !== 'recording') return;

    const recordingId = currentRecordingId || state.recordingId;
    if (!recordingId) return;

    const relativeTime = await getRelativeTime();

    const action: ActionLog = {
      id: `action_${Date.now()}`,
      timestamp: Date.now(),
      relativeTime,
      type: 'tab_create',
      url: tab.url || '',
      pageTitle: tab.title || '',
      details: {
        tabId: tab.id,
      },
      humanReadable: `Created new tab${tab.url ? `: ${tab.url}` : ''}`,
    };

    await saveAction(recordingId, action);
  });

  // Listen for tab closes
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const state = await getRecordingState();
    if (state.state !== 'recording') return;

    const recordingId = currentRecordingId || state.recordingId;
    if (!recordingId) return;

    const relativeTime = await getRelativeTime();

    const action: ActionLog = {
      id: `action_${Date.now()}`,
      timestamp: Date.now(),
      relativeTime,
      type: 'tab_close',
      url: '',
      pageTitle: '',
      details: {
        tabId,
      },
      humanReadable: `Closed tab #${tabId}`,
    };

    await saveAction(recordingId, action);
  });

  // Listen for navigation
  chrome.webNavigation.onCompleted.addListener(async (details) => {
    if (details.frameId !== 0) return; // Only main frame

    const state = await getRecordingState();
    if (state.state !== 'recording') return;

    const recordingId = currentRecordingId || state.recordingId;
    if (!recordingId) return;

    try {
      const tab = await chrome.tabs.get(details.tabId);
      const relativeTime = await getRelativeTime();

      const action: ActionLog = {
        id: `action_${Date.now()}`,
        timestamp: Date.now(),
        relativeTime,
        type: 'navigation',
        url: details.url,
        pageTitle: tab.title || '',
        details: {
          toUrl: details.url,
        },
        humanReadable: `Navigated to: ${details.url}`,
      };

      await saveAction(recordingId, action);
      visitedPages.add(details.url);
    } catch (error) {
      console.error('[Background] Error logging navigation:', error);
    }
  });
});

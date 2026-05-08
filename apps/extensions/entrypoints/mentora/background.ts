import { v4 as uuidv4 } from 'uuid';
import {
  saveVideoChunk,
  saveAudioChunk,
  saveScreenshot,
  saveAction,
  saveMetadata,
  getMetadata,
  getActions,
  getScreenshots,
  getVideoChunks,
  getFinalVideo,
  getAudioChunks,
  getActionCount,
  getScreenshotCount,
  clearRecording,
  saveFinalVideo,
  saveNetworkEvent,
  getNetworkEvents,
} from '../../utils/mentora/db';
import {
  getRecordingState,
  startRecording as startRecordingState,
  pauseRecording as pauseRecordingState,
  resumeRecording as resumeRecordingState,
  stopRecording as stopRecordingState,
  getRelativeTime,
} from '../../utils/mentora/storage';
import type { ActionLog, NetworkEvent, Screenshot, StateResponse } from '../../utils/mentora/messages';
import { exportToZip } from '../../utils/mentora/zip-export';

export default defineBackground(() => {
  console.log('[Background] Service worker started');

  let currentRecordingId: string | null = null;
  let offscreenReady = false;
  const visitedPages = new Set<string>();
  let lastMicPermissionOpen = 0;
  let pendingStart = false;
  let startInProgress = false;

  // Restore state on startup
  getRecordingState().then(async (state) => {
    if (state.recordingId && state.state !== 'idle') {
      currentRecordingId = state.recordingId;
      console.log('[Background] Restored recording state:', state.state);

      // Check if offscreen exists
      const hasOffscreen = await checkOffscreenExists();
      if (!hasOffscreen && state.state === 'recording') {
        // Recording was in progress but offscreen is gone - stop the recording
        console.log('[Background] Offscreen lost, stopping recording...');
        await stopRecordingState();
        currentRecordingId = null;
        await updateBadge('idle');
      } else {
        await updateBadge(state.state === 'paused' ? 'paused' : 'recording');
      }
    }
  });

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
    message: { type: string; action?: ActionLog; networkEvent?: { method: string; url: string; status: number; contentType: string; requestBody: string | null; responseBody: string | null }; chunk?: number[]; data?: number[]; index?: number; target?: string },
    sender: chrome.runtime.MessageSender
  ): Promise<unknown> {
    if (sender.url?.includes('offscreen.html') && message.target !== 'background') {
      return { success: false, error: 'Ignored non-background message' };
    }

    const state = await getRecordingState();

    switch (message.type) {
      // Popup messages
      case 'START_RECORDING':
        return await startRecording();
      case 'PAUSE_RECORDING':
        return await pauseRecording();
      case 'RESUME_RECORDING':
        return await resumeRecording();
      case 'STOP_RECORDING':
        return await stopRecording();
      case 'GET_STATE':
        return await getState();
      case 'DOWNLOAD_RECORDING':
        return await downloadRecording();

      // Content script messages
      case 'LOG_ACTION':
        if (state.state === 'recording' && message.action) {
          return await logAction(message.action, sender.tab?.id);
        }
        return { success: false };
      case 'LOG_NETWORK_EVENT':
        if (state.state === 'recording' && message.networkEvent) {
          return await logNetworkEvent(message.networkEvent);
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
      case 'VIDEO_CHUNK':
        if (currentRecordingId && message.chunk) {
          const buffer = new Uint8Array(message.chunk).buffer;
          await saveVideoChunk(currentRecordingId, buffer);
          console.log('[Background] Video chunk saved, size:', message.chunk.length);
        }
        return { success: true };
      case 'FINAL_VIDEO':
        if (currentRecordingId && message.data) {
          const buffer = new Uint8Array(message.data).buffer;
          await saveFinalVideo(currentRecordingId, buffer);
          console.log('[Background] Final video saved, size:', message.data.length);
        }
        return { success: true };
      case 'AUDIO_CHUNK':
        if (currentRecordingId && message.data && message.index !== undefined) {
          const buffer = new Uint8Array(message.data).buffer;
          await saveAudioChunk(currentRecordingId, message.index, buffer);
          console.log(`[Background] Audio chunk ${message.index} saved, size: ${message.data.length}`);
        }
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
        offscreenReady = false;
        return { success: true };
      case 'CAPTURE_STOPPED_BY_USER':
        console.log('[Background] User stopped sharing');
        await handleUserStoppedSharing();
        return { success: true };
      case 'CAPTURE_ERROR':
        console.error('[Background] Capture error:', message);
        await stopRecordingState();
        await updateBadge('idle');
        currentRecordingId = null;
        offscreenReady = false;
        return { success: false };
      case 'MIC_PERMISSION_NEEDED':
        await openMicPermissionPage();
        return { success: true };
      case 'MIC_PERMISSION_GRANTED':
        if (pendingStart && !startInProgress) {
          await startRecording();
        }
        return { success: true };

      default:
        console.log('[Background] Unknown message type:', message.type);
        return { error: 'Unknown message type' };
    }
  }

  async function startRecording(): Promise<{ success: boolean; error?: string }> {
    if (startInProgress) {
      return { success: false, error: 'Start already in progress' };
    }
    try {
      startInProgress = true;
      pendingStart = true;
      console.log('[Background] Starting recording...');

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
        currentRecordingId = null;
        return { success: false, error: 'Offscreen document not ready' };
      }

      // Start capture in offscreen document
      console.log('[Background] Sending START_CAPTURE to offscreen...');
      const response = await sendToOffscreen({ type: 'START_CAPTURE' });
      console.log('[Background] Start capture response:', response);

      if (!response?.success) {
        // User cancelled or error
        currentRecordingId = null;
        startInProgress = false;
        if (response?.error === 'MIC_PERMISSION_REQUIRED') {
          await openMicPermissionPage();
          return { success: false, error: 'Microphone permission required' };
        }
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
      return { success: true };
    } catch (error) {
      console.error('[Background] Failed to start recording:', error);
      await stopRecordingState();
      currentRecordingId = null;
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

  async function stopRecording(): Promise<{ success: boolean }> {
    console.log('[Background] Stopping recording...');

    const recordingIdToStop = currentRecordingId;

    if (!recordingIdToStop) {
      // Try to get from storage
      const state = await getRecordingState();
      if (!state.recordingId) {
        return { success: false };
      }
    }

    try {
      // Stop capture
      const hasOffscreen = await checkOffscreenExists();
      if (hasOffscreen) {
        const response = await sendToOffscreen({ type: 'STOP_CAPTURE' });
        console.log('[Background] Stop response from offscreen:', response);
      }
    } catch (error) {
      console.log('[Background] Error stopping capture (may already be stopped):', error);
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
        });
      }
    }

    await stopRecordingState();
    await notifyAllTabs('RECORDING_STATE_CHANGED', { state: 'idle' });
    await closeOffscreenDocument();
    await closeMicPermissionTab();
    await updateBadge('idle');
    offscreenReady = false;

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
    raw: { method: string; url: string; status: number; contentType: string; requestBody: string | null; responseBody: string | null }
  ): Promise<{ success: boolean }> {
    const recordingId = currentRecordingId || (await getRecordingState()).recordingId;
    if (!recordingId) return { success: false };

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

    const relTime = await getRelativeTime();

    const event: NetworkEvent = {
      id: `net_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      relativeTime: relTime,
      timestamp: Date.now(),
      method: raw.method,
      url: raw.url,
      status: raw.status,
      contentType: raw.contentType,
      requestBody: raw.requestBody,
      responseBody: raw.responseBody,
      host: parsedUrl.host,
      pathname: parsedUrl.pathname,
    };

    await saveNetworkEvent(recordingId, event);
    console.log(`[Background] Network event saved: ${raw.method} ${parsedUrl.pathname} → ${raw.status}`);
    return { success: true };
  }

  async function downloadRecording(): Promise<{ success: boolean; error?: string }> {
    const state = await getRecordingState();
    const recordingId = currentRecordingId || state.recordingId;

    if (!recordingId) {
      return { success: false, error: 'No recording available' };
    }

    try {
      console.log('[Background] Preparing download for recording:', recordingId);

      const metadata = await getMetadata(recordingId);
      const actions = await getActions(recordingId);
      const screenshots = await getScreenshots(recordingId);
      const networkEvents = await getNetworkEvents(recordingId);
      const finalVideo = await getFinalVideo(recordingId);
      const videoChunks = finalVideo ? [] : await getVideoChunks(recordingId);
      const audioChunks = await getAudioChunks(recordingId);

      const totalVideoBytes = videoChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      console.log('[Background] Data collected:', {
        hasMetadata: !!metadata,
        actions: actions.length,
        screenshots: screenshots.length,
        networkEvents: networkEvents.length,
        videoChunks: videoChunks.length,
        videoBytes: totalVideoBytes,
        audioChunks: audioChunks.length,
      });

      if (!metadata) {
        return { success: false, error: 'Recording metadata not found' };
      }

      const zipBlob = await exportToZip(metadata, actions, screenshots, videoChunks, finalVideo || undefined, audioChunks, networkEvents);

      // Convert blob to base64 data URL (Service Workers don't have URL.createObjectURL)
      const arrayBuffer = await zipBlob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );
      const dataUrl = `data:application/zip;base64,${base64}`;

      const filename = `mentora-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

      await chrome.downloads.download({
        url: dataUrl,
        filename,
        saveAs: true,
      });

      // Clear the recording data
      await clearRecording(recordingId);
      currentRecordingId = null;

      console.log('[Background] Download initiated');
      return { success: true };
    } catch (error) {
      console.error('[Background] Failed to download recording:', error);
      return { success: false, error: String(error) };
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
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: [chrome.offscreen.Reason.USER_MEDIA],
          justification: 'Recording screen and microphone for tutorial capture',
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

  async function sendToOffscreen(message: { type: string }): Promise<{ success: boolean; error?: string }> {
    // Send message and wait for response
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ ...message, target: 'offscreen' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Background] Error sending to offscreen:', chrome.runtime.lastError);
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: 'No response' });
        }
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

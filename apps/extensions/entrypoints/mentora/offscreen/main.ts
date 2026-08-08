/**
 * Offscreen document for media recording
 * Required in MV3 because service workers can't access getUserMedia/getDisplayMedia
 */

import {
  getActions,
  getAudioChunks,
  getFinalVideo,
  getMetadata,
  getNetworkEvents,
  getScreenshots,
  getVideoChunks,
  saveAudioChunk,
  saveVideoChunk,
} from '../../../utils/mentora/db';
import { exportToZip } from '../../../utils/mentora/zip-export';
import { loadTranscriptionSettings } from '../../../utils/mentora/transcription-settings';

let incrementalRecorder: MediaRecorder | null = null;
let audioChunkRecorder: MediaRecorder | null = null;
let chunkCount = 0;
let audioChunkIndex = 0;
let audioChunkTimer: number | null = null;
const pendingAudioChunkSaves = new Set<Promise<void>>();
const pendingVideoChunkSaves = new Set<Promise<void>>();
const audioChunkEndTimes = new WeakMap<MediaRecorder, number>();
let microphoneStream: MediaStream | null = null;
let displayStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let audioDestination: MediaStreamAudioDestinationNode | null = null;
let audioSourceNodes: MediaStreamAudioSourceNode[] = [];
let mixedAudioTrack: MediaStreamTrack | null = null;
interface CaptureStopResponse {
  success: boolean;
  error?: string;
  warnings?: string[];
}

let stopCapturePromise: Promise<CaptureStopResponse> | null = null;
let currentRecordingId: string | null = null;
let captureWarnings: string[] = [];
let captureStartedAt: number | null = null;
let capturePausedAt: number | null = null;
let totalPausedDuration = 0;

const AUDIO_CHUNK_DURATION_MS = 5 * 60 * 1000;
const STOP_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

function getCaptureTime(): number {
  if (captureStartedAt === null) return 0;
  const now = capturePausedAt ?? performance.now();
  return Math.max(0, (now - captureStartedAt - totalPausedDuration) / 1000);
}

function buildCombinedStream(audioTrack: MediaStreamTrack | null): MediaStream {
  if (!displayStream) {
    return new MediaStream();
  }

  const combinedStream = new MediaStream();
  displayStream.getVideoTracks().forEach((track) => combinedStream.addTrack(track));
  if (audioTrack) combinedStream.addTrack(audioTrack);

  return combinedStream;
}

function startIncrementalRecorder(stream: MediaStream): void {
  if (stream.getVideoTracks().length === 0) {
    console.error('[Offscreen] No video track in combined stream');
    return;
  }

  incrementalRecorder = new MediaRecorder(stream, {
    videoBitsPerSecond: 1_500_000, // 1.5 Mbps for good quality/size balance
  });

  chunkCount = 0;

  incrementalRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      console.log('[Offscreen] dataavailable size:', event.data.size);
      chunkCount += 1;

      const recordingId = currentRecordingId;
      if (!recordingId) {
        captureWarnings.push('A video chunk could not be linked to the recording.');
        return;
      }

      const save = event.data
        .arrayBuffer()
        .then((buffer) => saveVideoChunk(recordingId, buffer))
        .catch((error) => {
          console.error('[Offscreen] Failed to save video chunk:', error);
          captureWarnings.push('A video chunk could not be saved.');
        })
        .finally(() => pendingVideoChunkSaves.delete(save));
      pendingVideoChunkSaves.add(save);
    } else {
      console.log('[Offscreen] dataavailable empty');
    }
  };

  incrementalRecorder.onerror = (event) => {
    console.error('[Offscreen] MediaRecorder error:', event);
    chrome.runtime.sendMessage({
      type: 'CAPTURE_ERROR',
      error: 'Recording error occurred',
      target: 'background',
    });
  };

  incrementalRecorder.onstop = () => {
    console.log('[Offscreen] Incremental recorder stopped');
  };

  incrementalRecorder.start(1000);
  console.log('[Offscreen] Incremental recorder state:', incrementalRecorder.state);
}

/**
 * Mix display and microphone audio into one track. Chromium's MediaRecorder
 * records only the first audio track, so passing both tracks separately can
 * drop the microphone when display audio is present.
 */
async function buildMixedAudioTrack(): Promise<MediaStreamTrack | null> {
  const audioTracks: MediaStreamTrack[] = [];

  if (displayStream) {
    displayStream.getAudioTracks().forEach((t) => audioTracks.push(t));
  }
  if (microphoneStream) {
    microphoneStream.getAudioTracks().forEach((t) => audioTracks.push(t));
  }

  if (audioTracks.length === 0) return null;
  if (audioTracks.length === 1) return audioTracks[0];

  audioContext = new AudioContext();
  audioDestination = audioContext.createMediaStreamDestination();
  audioSourceNodes = audioTracks.map((track) => {
    const source = audioContext!.createMediaStreamSource(new MediaStream([track]));
    source.connect(audioDestination!);
    return source;
  });

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  return audioDestination.stream.getAudioTracks()[0] ?? null;
}

/**
 * Build an audio-only stream for transcription from the mixed audio track.
 */
function buildAudioOnlyStream(audioTrack: MediaStreamTrack | null): MediaStream | null {
  return audioTrack ? new MediaStream([audioTrack]) : null;
}

/**
 * Start recording audio in five-minute chunks.
 * Each chunk is stored for later transcription.
 */
function startAudioChunkRecording(stream: MediaStream): void {
  audioChunkIndex = 0;
  startNextAudioChunk(stream);

  // Every AUDIO_CHUNK_DURATION_MS, stop the current chunk and start a new one
  audioChunkTimer = window.setInterval(() => {
    if (audioChunkRecorder?.state === 'recording') {
      rotateAudioChunk(stream);
    }
  }, AUDIO_CHUNK_DURATION_MS);
}

function startNextAudioChunk(stream: MediaStream): void {
  const chunkIndex = audioChunkIndex;
  const startedAt = getCaptureTime();
  audioChunkIndex += 1;

  // Use webm/opus which is compact (~6KB/s mono) and Whisper accepts directly
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const recorder = new MediaRecorder(stream, {
    mimeType,
    audioBitsPerSecond: 48000, // 48 kbps mono ≈ 1.8 MB per chunk
  });
  audioChunkRecorder = recorder;

  const chunks: Blob[] = [];
  let resolveSaved!: () => void;
  const saved = new Promise<void>((resolve) => {
    resolveSaved = resolve;
  });
  pendingAudioChunkSaves.add(saved);

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  recorder.onstop = async () => {
    const endedAt = audioChunkEndTimes.get(recorder) ?? getCaptureTime();
    try {
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, { type: 'audio/webm' });
      console.log(`[Offscreen] Audio chunk ${chunkIndex} complete: ${(blob.size / 1024).toFixed(0)} KB`);
      const buffer = await blob.arrayBuffer();
      if (!currentRecordingId) {
        throw new Error('Audio chunk is missing its recording ID');
      }
      await saveAudioChunk(currentRecordingId, chunkIndex, buffer, startedAt, endedAt);
    } catch (error) {
      console.error(`[Offscreen] Failed to save audio chunk ${chunkIndex}:`, error);
    } finally {
      pendingAudioChunkSaves.delete(saved);
      resolveSaved();
    }
  };

  try {
    recorder.start(1000); // collect data every second internally
  } catch (error) {
    pendingAudioChunkSaves.delete(saved);
    resolveSaved();
    throw error;
  }
  console.log(`[Offscreen] Audio chunk recorder started (chunk ${chunkIndex})`);
}

function rotateAudioChunk(stream: MediaStream): void {
  if (audioChunkRecorder && audioChunkRecorder.state !== 'inactive') {
    audioChunkEndTimes.set(audioChunkRecorder, getCaptureTime());
    audioChunkRecorder.stop(); // triggers onstop → sends chunk
  }
  startNextAudioChunk(stream);
}

async function stopAudioChunkRecording(): Promise<void> {
  if (audioChunkTimer) {
    clearInterval(audioChunkTimer);
    audioChunkTimer = null;
  }
  if (audioChunkRecorder && audioChunkRecorder.state !== 'inactive') {
    audioChunkEndTimes.set(audioChunkRecorder, getCaptureTime());
    audioChunkRecorder.stop(); // sends the last partial chunk
  }
  audioChunkRecorder = null;
  await Promise.all([...pendingAudioChunkSaves]);
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') {
    return false;
  }

  console.log('[Offscreen] Received message:', message.type);
  handleMessage(message)
    .then((result) => {
      console.log('[Offscreen] Sending response:', result);
      sendResponse(result);
    })
    .catch((error) => {
      console.error('[Offscreen] Error:', error);
      sendResponse({ success: false, error: String(error) });
    });
  return true; // Keep channel open for async response
});

async function handleMessage(message: { type: string; recordingId?: string }) {
  switch (message.type) {
    case 'START_CAPTURE':
      return await startCapture(message.recordingId);
    case 'PAUSE_CAPTURE':
      return pauseCapture();
    case 'RESUME_CAPTURE':
      return resumeCapture();
    case 'STOP_CAPTURE':
      return await stopCapture();
    case 'EXPORT_RECORDING':
      return await exportRecording(message.recordingId);
    default:
      return { error: 'Unknown message type' };
  }
}

async function startCapture(recordingId?: string) {
  try {
    if (!recordingId) {
      return { success: false, error: 'Recording ID is required' };
    }
    currentRecordingId = recordingId;
    captureWarnings = [];
    console.log('[Offscreen] Starting capture...');

    // Try to get microphone audio first
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.log('[Offscreen] Got microphone stream');
    } catch (micError) {
      console.warn('[Offscreen] Microphone access denied or unavailable:', micError);
      chrome.runtime.sendMessage({
        type: 'MIC_PERMISSION_NEEDED',
        target: 'background',
        error: String(micError),
      });
      cleanup();
      return { success: false, error: 'MIC_PERMISSION_REQUIRED' };
    }

    // Request screen capture with getDisplayMedia - this will show the permission dialog
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true, // Capture tab audio if available
    });

    console.log('[Offscreen] Got display stream');

    // Combine streams
    const displayVideoTracks = displayStream.getVideoTracks();
    const displayAudioTracks = displayStream.getAudioTracks();
    console.log('[Offscreen] Display tracks:', {
      video: displayVideoTracks.length,
      audio: displayAudioTracks.length,
    });
    if (displayVideoTracks[0]) {
      const videoTrack = displayVideoTracks[0];
      console.log('[Offscreen] Video track state:', {
        readyState: videoTrack.readyState,
        enabled: videoTrack.enabled,
        muted: videoTrack.muted,
        settings: videoTrack.getSettings?.(),
      });
    } else {
      console.log('[Offscreen] No video track present in display stream');
    }
    // Add video track from display
    displayVideoTracks.forEach((track) => {
      // Handle track ending (user stops sharing)
      track.onended = async () => {
        console.log('[Offscreen] Display track ended');
        await stopCapture();
        chrome.runtime.sendMessage({ type: 'CAPTURE_STOPPED_BY_USER', target: 'background' });
      };
    });

    mixedAudioTrack = await buildMixedAudioTrack();
    const combinedStream = buildCombinedStream(mixedAudioTrack);
    if (combinedStream.getVideoTracks().length === 0) {
      console.error('[Offscreen] No video track in combined stream');
      return { success: false, error: 'No video track available for recording' };
    }

    captureStartedAt = performance.now();
    capturePausedAt = null;
    totalPausedDuration = 0;

    // Start recording with 1 second chunks for incremental saving
    startIncrementalRecorder(combinedStream);

    // Start audio-only chunk recording for transcription (non-critical)
    try {
      const audioStream = buildAudioOnlyStream(mixedAudioTrack);
      if (audioStream) {
        startAudioChunkRecording(audioStream);
        console.log('[Offscreen] Audio chunk recording started');
      } else {
        console.warn('[Offscreen] No audio tracks available for transcription chunks');
      }
    } catch (audioErr) {
      console.warn('[Offscreen] Audio chunk recording failed to start (non-critical):', audioErr);
    }

    console.log('[Offscreen] Recording started');

    // Notify background
    chrome.runtime.sendMessage({ type: 'CAPTURE_STARTED', target: 'background' });

    return { success: true };
  } catch (error) {
    console.error('[Offscreen] Failed to start capture:', error);
    cleanup();
    return { success: false, error: String(error) };
  }
}

function pauseCapture() {
  console.log('[Offscreen] Pause requested, states:', {
    incremental: incrementalRecorder?.state,
  });
  let paused = false;
  if (incrementalRecorder && incrementalRecorder.state === 'recording') {
    incrementalRecorder.pause();
    paused = true;
  }
  if (audioChunkRecorder && audioChunkRecorder.state === 'recording') {
    audioChunkRecorder.pause();
  }
  if (paused) {
    capturePausedAt = performance.now();
    chrome.runtime.sendMessage({ type: 'CAPTURE_PAUSED', target: 'background' });
    return { success: true };
  }
  return { success: false, error: 'Not recording' };
}

function resumeCapture() {
  console.log('[Offscreen] Resume requested, states:', {
    incremental: incrementalRecorder?.state,
  });
  let resumed = false;
  if (incrementalRecorder && incrementalRecorder.state === 'paused') {
    incrementalRecorder.resume();
    resumed = true;
  }
  if (audioChunkRecorder && audioChunkRecorder.state === 'paused') {
    audioChunkRecorder.resume();
  }
  if (resumed) {
    if (capturePausedAt !== null) {
      totalPausedDuration += performance.now() - capturePausedAt;
      capturePausedAt = null;
    }
    chrome.runtime.sendMessage({ type: 'CAPTURE_RESUMED', target: 'background' });
    return { success: true };
  }
  return { success: false, error: 'Not paused' };
}

function stopCapture(): Promise<CaptureStopResponse> {
  if (!stopCapturePromise) {
    stopCapturePromise = performStopCapture().finally(() => {
      stopCapturePromise = null;
    });
  }
  return stopCapturePromise;
}

async function performStopCapture(): Promise<CaptureStopResponse> {
  console.log('[Offscreen] Stop requested');

  const audioStopped = await settleWithin(
    stopAudioChunkRecording(),
    STOP_TIMEOUT_MS,
    'The last audio chunk did not finish in time.'
  );
  if (!audioStopped) {
    captureWarnings.push('The last audio chunk may be incomplete.');
  }

  if (!incrementalRecorder || incrementalRecorder.state === 'inactive') {
    console.log('[Offscreen] No active recording to stop');
    cleanup();
    return { success: true, warnings: captureWarnings };
  }

  const recorderStopped = await settleWithin(
    new Promise<void>((resolve) => {
      if (!incrementalRecorder || incrementalRecorder.state === 'inactive') {
        resolve();
        return;
      }
      incrementalRecorder.onstop = () => {
        console.log('[Offscreen] Incremental recorder stopped');
        resolve();
      };
      incrementalRecorder.stop();
    }),
    STOP_TIMEOUT_MS,
    'The video recorder did not stop in time.'
  );
  if (!recorderStopped) {
    captureWarnings.push('The last video chunk may be incomplete.');
  }

  const videoSaved = await settleWithin(
    Promise.all([...pendingVideoChunkSaves]).then(() => undefined),
    STOP_TIMEOUT_MS,
    'Pending video chunks were not saved in time.'
  );
  if (!videoSaved) captureWarnings.push('Some pending video chunks may be missing.');

  chrome.runtime.sendMessage({
    type: 'CAPTURE_STOPPED',
    totalChunks: chunkCount,
    target: 'background',
  });

  cleanup();
  return { success: true, warnings: captureWarnings };
}

async function settleWithin(
  promise: Promise<void>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<boolean> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = window.setTimeout(() => {
          console.warn(`[Offscreen] ${timeoutMessage}`);
          resolve(false);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

async function exportRecording(recordingId?: string): Promise<{ success: boolean; error?: string }> {
  if (!recordingId) return { success: false, error: 'Recording ID is required' };

  let downloadUrl: string | null = null;
  try {
    const metadata = await getMetadata(recordingId);
    if (!metadata) return { success: false, error: 'Recording metadata not found' };

    const [actions, screenshots, networkEvents, finalVideo, audioChunks] = await Promise.all([
      getActions(recordingId),
      getScreenshots(recordingId),
      getNetworkEvents(recordingId),
      getFinalVideo(recordingId),
      getAudioChunks(recordingId),
    ]);
    const videoChunks = finalVideo ? [] : await getVideoChunks(recordingId);
    const settings = await loadTranscriptionSettings();
    const transcriptionEnabled =
      metadata.transcriptionEnabled ?? Boolean(settings.openRouterApiKey);

    const zipBlob = await exportToZip(
      metadata,
      actions,
      screenshots,
      videoChunks,
      finalVideo ?? undefined,
      audioChunks,
      networkEvents,
      transcriptionEnabled ? settings.openRouterApiKey ?? undefined : undefined,
      notifyExportStage
    );

    downloadUrl = URL.createObjectURL(zipBlob);
    await notifyExportStage('downloading');
    const filename = `mentora-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    const downloadId = await chrome.downloads.download({
      url: downloadUrl,
      filename,
      saveAs: true,
    });
    await waitForDownload(downloadId);
    return { success: true };
  } catch (error) {
    console.error('[Offscreen] Export failed:', error);
    return { success: false, error: String(error) };
  } finally {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    await notifyExportFinished();
  }
}

function notifyExportStage(stage: 'transcribing' | 'packaging' | 'downloading'): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'EXPORT_STAGE_CHANGED', stage, target: 'background' },
      () => resolve()
    );
  });
}

function notifyExportFinished(): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'EXPORT_FINISHED', target: 'background' },
      () => resolve()
    );
  });
}

function waitForDownload(downloadId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
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
      window.clearTimeout(timeout);
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

function cleanup() {
  console.log('[Offscreen] Cleaning up...');

  // Stop all tracks
  displayStream?.getTracks().forEach((track) => track.stop());
  microphoneStream?.getTracks().forEach((track) => track.stop());
  mixedAudioTrack?.stop();

  // Close audio context
  audioSourceNodes.forEach((source) => source.disconnect());
  audioDestination?.disconnect();
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
  }

  displayStream = null;
  microphoneStream = null;
  audioContext = null;
  audioDestination = null;
  audioSourceNodes = [];
  mixedAudioTrack = null;
  incrementalRecorder = null;
  audioChunkRecorder = null;
  audioChunkIndex = 0;
  chunkCount = 0;
  captureStartedAt = null;
  capturePausedAt = null;
  totalPausedDuration = 0;
}

// Notify background that offscreen is ready
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY', target: 'background' }).catch(() => {
  // Background might not be ready yet
});

console.log('[Offscreen] Script loaded and ready');

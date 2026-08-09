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
  getRecordingExport,
  getScreenshots,
  getOrderedVideoChunks,
  getVideoManifest,
  getVideoChunks,
  deleteOrderedVideoChunks,
  saveAudioChunk,
  saveFinalVideo,
  saveMetadata,
  saveRecordingExport,
  saveOrderedVideoChunk,
  saveVideoManifest,
} from '../../../utils/mentora/db';
import { exportToZip } from '../../../utils/mentora/zip-export';
import type {
  VideoCaptureSummary,
  VideoChunkManifestEntry,
  VideoManifest,
  VideoStopReason,
} from '../../../utils/mentora/messages';
import {
  assembleVideo,
  chooseMp4MimeType,
  sha256Blob,
  validateVideoChunks,
} from '../../../utils/mentora/video-integrity';

let incrementalRecorder: MediaRecorder | null = null;
let audioChunkRecorder: MediaRecorder | null = null;
let chunkCount = 0;
let audioChunkIndex = 0;
let audioChunkTimer: number | null = null;
const pendingAudioChunkSaves = new Set<Promise<void>>();
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
  videoCapture?: VideoCaptureSummary;
}

let stopCapturePromise: Promise<CaptureStopResponse> | null = null;
let currentRecordingId: string | null = null;
let captureWarnings: string[] = [];
let activeDownloadUrl: string | null = null;
let captureStartedAt: number | null = null;
let capturePausedAt: number | null = null;
let totalPausedDuration = 0;
let videoMimeType = '';
let videoWriteQueue: Promise<void> = Promise.resolve();
let videoStopPromise: Promise<void> = Promise.resolve();
let resolveVideoStop: (() => void) | null = null;
let videoManifestEntries: VideoChunkManifestEntry[] = [];
let recorderError: string | undefined;
let lastStopResponse: CaptureStopResponse | null = null;
let lastVideoManifest: VideoManifest | null = null;

const AUDIO_CHUNK_DURATION_MS = 5 * 60 * 1000;
const STOP_TIMEOUT_MS = 30_000;
const VIDEO_WRITE_TIMEOUT_MS = 120_000;

function getCaptureTime(): number {
  if (captureStartedAt === null) return 0;
  const now = capturePausedAt ?? performance.now();
  return Math.max(0, (now - captureStartedAt - totalPausedDuration) / 1000);
}

function formatCaptureDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
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

  const mimeType = chooseMp4MimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) throw new Error('VIDEO_CODEC_UNAVAILABLE');

  incrementalRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 1_500_000,
    audioBitsPerSecond: 64_000,
  });
  videoMimeType = incrementalRecorder.mimeType || mimeType;

  chunkCount = 0;
  videoWriteQueue = Promise.resolve();
  videoManifestEntries = [];
  recorderError = undefined;
  videoStopPromise = new Promise<void>((resolve) => {
    resolveVideoStop = resolve;
  });

  incrementalRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      console.log('[Offscreen] dataavailable size:', event.data.size);
      const sequence = chunkCount;
      chunkCount += 1;

      const recordingId = currentRecordingId;
      if (!recordingId) {
        captureWarnings.push('A video chunk could not be linked to the recording.');
        videoManifestEntries.push({
          sequence,
          timecodeMs: event.timecode,
          size: event.data.size,
          mimeType: event.data.type || videoMimeType,
          attempts: 0,
          stored: false,
          error: 'The recording ID was missing.',
        });
        return;
      }

      const blob = event.data;
      videoWriteQueue = videoWriteQueue.then(async () => {
        let attempts = 0;
        let lastError: unknown;
        let sha256: string;
        try {
          sha256 = await sha256Blob(blob);
        } catch (error) {
          const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          captureWarnings.push(`Video chunk ${sequence} could not be hashed: ${message}`);
          videoManifestEntries.push({
            sequence,
            timecodeMs: event.timecode,
            size: blob.size,
            mimeType: blob.type || videoMimeType,
            attempts: 0,
            stored: false,
            error: message,
          });
          return;
        }

        while (attempts < 3) {
          attempts += 1;
          try {
            await saveOrderedVideoChunk(recordingId, {
              sequence,
              blob,
              timecodeMs: event.timecode,
              size: blob.size,
              mimeType: blob.type || videoMimeType,
              sha256,
              attempts,
            });
            videoManifestEntries.push({
              sequence,
              timecodeMs: event.timecode,
              size: blob.size,
              mimeType: blob.type || videoMimeType,
              sha256,
              attempts,
              stored: true,
            });
            return;
          } catch (error) {
            lastError = error;
            if (error instanceof DOMException && error.name === 'QuotaExceededError') break;
            if (attempts < 3) await new Promise((resolve) => window.setTimeout(resolve, attempts * 250));
          }
        }

        const message = lastError instanceof Error ? `${lastError.name}: ${lastError.message}` : String(lastError);
        console.error(`[Offscreen] Failed to save video chunk ${sequence}:`, lastError);
        captureWarnings.push(`Video chunk ${sequence} could not be saved: ${message}`);
        videoManifestEntries.push({
          sequence,
          timecodeMs: event.timecode,
          size: blob.size,
          mimeType: blob.type || videoMimeType,
          sha256,
          attempts,
          stored: false,
          error: message,
        });
      });
    } else {
      console.log('[Offscreen] dataavailable empty');
    }
  };

  incrementalRecorder.onerror = (event) => {
    console.error('[Offscreen] MediaRecorder error:', event);
    recorderError = event.error?.message || 'MediaRecorder reported an unknown error.';
    captureWarnings.push(`Video recorder error: ${recorderError}`);
    void stopCapture('recorder-error').then(() => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_STOPPED_BY_USER', target: 'background' });
    });
  };

  incrementalRecorder.onstop = () => {
    console.log('[Offscreen] Incremental recorder stopped');
    resolveVideoStop?.();
    resolveVideoStop = null;
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

async function handleMessage(message: {
  type: string;
  recordingId?: string;
  openRouterApiKey?: string;
}) {
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
      return await exportRecording(message.recordingId, message.openRouterApiKey);
    case 'RELEASE_DOWNLOAD_URL':
      releaseDownloadUrl();
      return { success: true };
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
    lastStopResponse = null;
    lastVideoManifest = null;
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
        await stopCapture('share-ended');
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
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message === 'VIDEO_CODEC_UNAVAILABLE'
        ? 'Chrome cannot encode the required MP4 format.'
        : message,
      errorCode: message === 'VIDEO_CODEC_UNAVAILABLE' ? 'VIDEO_CODEC_UNAVAILABLE' : undefined,
    };
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

function stopCapture(reason: VideoStopReason = 'user'): Promise<CaptureStopResponse> {
  if (!incrementalRecorder && lastStopResponse) return Promise.resolve(lastStopResponse);
  if (!stopCapturePromise) {
    stopCapturePromise = performStopCapture(reason).finally(() => {
      stopCapturePromise = null;
    });
  }
  return stopCapturePromise;
}

async function performStopCapture(reason: VideoStopReason): Promise<CaptureStopResponse> {
  console.log('[Offscreen] Stop requested');
  const recordingId = currentRecordingId;
  if (!recordingId) {
    return { success: false, error: 'Recording ID is required' };
  }
  const activeDurationMs = Math.round(getCaptureTime() * 1000);
  const pausedDurationMs = Math.round(totalPausedDuration + (
    capturePausedAt === null ? 0 : performance.now() - capturePausedAt
  ));

  const audioStopPromise = stopAudioChunkRecording();
  if (incrementalRecorder && incrementalRecorder.state !== 'inactive') {
    incrementalRecorder.stop();
  } else {
    resolveVideoStop?.();
    resolveVideoStop = null;
  }

  const [audioStopped, recorderStopped] = await Promise.all([
    settleWithin(audioStopPromise, STOP_TIMEOUT_MS, 'The last audio chunk did not finish in time.'),
    settleWithin(videoStopPromise, STOP_TIMEOUT_MS, 'The video recorder did not stop in time.'),
  ]);
  if (!audioStopped) captureWarnings.push('The last audio chunk may be incomplete.');
  if (!recorderStopped) {
    captureWarnings.push('The last video chunk may be incomplete.');
  }

  const videoSaved = await settleWithin(
    videoWriteQueue,
    VIDEO_WRITE_TIMEOUT_MS,
    'Pending video chunks were not saved in time.'
  );
  if (!videoSaved) captureWarnings.push('Some pending video chunks may be missing.');

  const chunks = await getOrderedVideoChunks(recordingId);
  const chunkValidation = await validateVideoChunks(chunks, chunkCount);
  let validationError = recorderError ?? chunkValidation.error;
  let status: VideoCaptureSummary['status'] = validationError ? 'recovery' : 'valid';
  const assembledVideo = assembleVideo(chunks, videoMimeType || 'video/mp4');

  if (status === 'valid') {
    validationError = await validatePlayableVideo(assembledVideo);
    if (validationError) status = 'recovery';
  }

  if (status === 'valid') {
    try {
      await saveFinalVideo(recordingId, assembledVideo, videoMimeType, 'video.mp4');
    } catch (error) {
      validationError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      status = 'recovery';
    }
  }
  if (status === 'valid') {
    try {
      await deleteOrderedVideoChunks(recordingId);
    } catch (error) {
      captureWarnings.push(`Validated video chunks could not be removed: ${String(error)}`);
    }
  }
  if (status === 'recovery' && validationError) {
    captureWarnings.push(`The final MP4 could not be validated: ${validationError}`);
  }

  const manifest: VideoManifest = {
    version: 1,
    recordingId,
    mimeType: videoMimeType || 'video/mp4',
    activeDurationMs,
    pausedDurationMs,
    emittedChunks: chunkCount,
    storedChunks: chunks.length,
    totalBytes: chunkValidation.totalBytes,
    stopReason: recorderError ? 'recorder-error' : reason,
    status,
    missingSequences: chunkValidation.missingSequences,
    validationError,
    chunks: [...videoManifestEntries].sort((a, b) => a.sequence - b.sequence),
  };
  lastVideoManifest = manifest;
  try {
    await saveVideoManifest(manifest);
  } catch (error) {
    captureWarnings.push(`The video manifest could not be saved: ${String(error)}`);
  }

  const videoCapture: VideoCaptureSummary = {
    format: 'mp4',
    mimeType: manifest.mimeType,
    activeDurationMs,
    pausedDurationMs,
    emittedChunks: chunkCount,
    storedChunks: chunks.length,
    totalBytes: chunkValidation.totalBytes,
    stopReason: manifest.stopReason,
    status,
    manifestFile: 'video-manifest.json',
  };
  const metadata = await getMetadata(recordingId);
  if (metadata) {
    try {
      await saveMetadata({
        ...metadata,
        videoDuration: formatCaptureDuration(activeDurationMs),
        videoCapture,
        captureWarnings: [...new Set([...(metadata.captureWarnings ?? []), ...captureWarnings])],
      });
    } catch (error) {
      captureWarnings.push(`The video summary could not be saved: ${String(error)}`);
    }
  }

  chrome.runtime.sendMessage({
    type: 'CAPTURE_STOPPED',
    totalChunks: chunkCount,
    target: 'background',
  });

  lastStopResponse = { success: true, warnings: captureWarnings, videoCapture };
  cleanup();
  return lastStopResponse;
}

async function validatePlayableVideo(blob: Blob): Promise<string | undefined> {
  if (blob.size === 0) return 'The assembled MP4 is empty.';
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';

  try {
    await waitForMediaEvent(video, url, 'loadedmetadata', 10_000);
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      return 'The MP4 has no finite duration.';
    }
    video.currentTime = Math.max(0, video.duration - Math.min(1, video.duration / 2));
    await waitForMediaEvent(video, url, 'seeked', 10_000, false);
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return 'Chrome could not load a frame near the end of the MP4.';
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

function waitForMediaEvent(
  video: HTMLVideoElement,
  url: string,
  eventName: 'loadedmetadata' | 'seeked',
  timeoutMs: number,
  setSource = true
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error(`Timed out waiting for ${eventName}.`)), timeoutMs);
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, handleSuccess);
      video.removeEventListener('error', handleError);
      error ? reject(error) : resolve();
    };
    const handleSuccess = () => finish();
    const handleError = () => finish(new Error(video.error?.message || `The MP4 failed during ${eventName}.`));
    video.addEventListener(eventName, handleSuccess, { once: true });
    video.addEventListener('error', handleError, { once: true });
    if (setSource) video.src = url;
  });
}

async function settleWithin(
  promise: Promise<void>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<boolean> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        (error) => {
          console.warn(`[Offscreen] ${timeoutMessage}`, error);
          return false;
        }
      ),
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

async function exportRecording(
  recordingId?: string,
  openRouterApiKey?: string
): Promise<{
  success: boolean;
  error?: string;
  downloadUrl?: string;
  filename?: string;
  artifactKind?: 'recording' | 'recovery';
  warning?: string;
}> {
  if (!recordingId) return { success: false, error: 'Recording ID is required' };

  try {
    const savedExport = await getRecordingExport(recordingId);
    if (savedExport) {
      releaseDownloadUrl();
      activeDownloadUrl = URL.createObjectURL(savedExport.blob);
      return {
        success: true,
        downloadUrl: activeDownloadUrl,
        filename: savedExport.filename,
        artifactKind: savedExport.artifactKind,
        warning: savedExport.warning,
      };
    }

    const metadata = await getMetadata(recordingId);
    if (!metadata) return { success: false, error: 'Recording metadata not found' };

    const [actions, screenshots, networkEvents, finalVideo, audioChunks, videoManifest] = await Promise.all([
      getActions(recordingId),
      getScreenshots(recordingId),
      getNetworkEvents(recordingId),
      getFinalVideo(recordingId),
      getAudioChunks(recordingId),
      getVideoManifest(recordingId),
    ]);
    const orderedChunks = finalVideo ? [] : await getOrderedVideoChunks(recordingId);
    const videoChunks = orderedChunks.length > 0
      ? orderedChunks
      : finalVideo
        ? []
        : await getVideoChunks(recordingId);
    const result = await exportToZip(
      metadata,
      actions,
      screenshots,
      videoChunks,
      finalVideo ?? undefined,
      audioChunks,
      networkEvents,
      openRouterApiKey,
      notifyExportStage,
      videoManifest ?? (lastVideoManifest?.recordingId === recordingId ? lastVideoManifest : null)
    );

    const prefix = result.artifactKind === 'recovery' ? 'mentora-recovery' : 'mentora-recording';
    const filename = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    try {
      await saveRecordingExport(
        recordingId,
        result.blob,
        filename,
        result.artifactKind,
        result.warning
      );
    } catch (error) {
      console.warn('[Offscreen] The generated ZIP could not be cached:', error);
    }

    releaseDownloadUrl();
    activeDownloadUrl = URL.createObjectURL(result.blob);
    return {
      success: true,
      downloadUrl: activeDownloadUrl,
      filename,
      artifactKind: result.artifactKind,
      warning: result.warning,
    };
  } catch (error) {
    console.error('[Offscreen] Export failed:', error);
    return { success: false, error: String(error) };
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

function releaseDownloadUrl(): void {
  if (!activeDownloadUrl) return;
  URL.revokeObjectURL(activeDownloadUrl);
  activeDownloadUrl = null;
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
  videoMimeType = '';
  videoWriteQueue = Promise.resolve();
  videoStopPromise = Promise.resolve();
  resolveVideoStop = null;
  videoManifestEntries = [];
  recorderError = undefined;
  captureStartedAt = null;
  capturePausedAt = null;
  totalPausedDuration = 0;
}

// Notify background that offscreen is ready
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY', target: 'background' }).catch(() => {
  // Background might not be ready yet
});

console.log('[Offscreen] Script loaded and ready');

export const NETWORK_PENDING_LIMIT = 500;
export const NETWORK_PENDING_TTL_MS = 5 * 60 * 1000;
export const NETWORK_EVENTS_PER_MINUTE = 1_200;
export const NETWORK_EVENTS_PER_RECORDING = 25_000;
export const NETWORK_BYTES_PER_RECORDING = 64 * 1024 * 1024;
export const ACTION_EVENTS_PER_MINUTE = 600;
export const ACTION_EVENTS_PER_RECORDING = 20_000;
export const ACTION_BYTES_PER_RECORDING = 16 * 1024 * 1024;
export const ACTION_INPUT_VALUE_LIMIT = 4 * 1024;
export const ACTION_TEXT_LIMIT = 2 * 1024;

export type CaptureLimitReason = 'rate' | 'count' | 'bytes';

export interface CaptureQuotaSummary {
  acceptedEvents: number;
  acceptedBytes: number;
  droppedEvents: number;
  droppedBytes: number;
  limitReached: boolean;
}

interface CaptureQuotaOptions {
  perMinute: number;
  maxEvents: number;
  maxBytes: number;
}

export class CaptureQuota {
  private acceptedEvents = 0;
  private acceptedBytes = 0;
  private droppedEvents = 0;
  private droppedBytes = 0;
  private readonly recentBySource = new Map<string, number[]>();

  constructor(private readonly options: CaptureQuotaOptions) {}

  reset(acceptedEvents = 0, acceptedBytes = 0): void {
    this.acceptedEvents = acceptedEvents;
    this.acceptedBytes = acceptedBytes;
    this.droppedEvents = 0;
    this.droppedBytes = 0;
    this.recentBySource.clear();
  }

  tryAccept(source: string | number, bytes: number, now = Date.now()): {
    accepted: boolean;
    reason?: CaptureLimitReason;
  } {
    const boundedBytes = Math.max(0, Math.floor(bytes));
    const key = String(source);
    const recent = this.recentBySource.get(key) ?? [];
    const cutoff = now - 60_000;
    let firstRecent = 0;
    while (firstRecent < recent.length && recent[firstRecent] <= cutoff) {
      firstRecent += 1;
    }
    if (firstRecent > 0) recent.splice(0, firstRecent);

    let reason: CaptureLimitReason | undefined;
    if (recent.length >= this.options.perMinute) reason = 'rate';
    else if (this.acceptedEvents >= this.options.maxEvents) reason = 'count';
    else if (this.acceptedBytes + boundedBytes > this.options.maxBytes) {
      reason = 'bytes';
    }

    if (reason) {
      this.droppedEvents += 1;
      this.droppedBytes += boundedBytes;
      this.recentBySource.set(key, recent);
      return { accepted: false, reason };
    }

    recent.push(now);
    this.recentBySource.set(key, recent);
    this.acceptedEvents += 1;
    this.acceptedBytes += boundedBytes;
    return { accepted: true };
  }

  summary(): CaptureQuotaSummary {
    return {
      acceptedEvents: this.acceptedEvents,
      acceptedBytes: this.acceptedBytes,
      droppedEvents: this.droppedEvents,
      droppedBytes: this.droppedBytes,
      limitReached: this.droppedEvents > 0,
    };
  }
}

export function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

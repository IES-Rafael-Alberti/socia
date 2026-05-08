import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ActionLog, Screenshot, RecordingMetadata, NetworkEvent } from './messages';

interface TeachSociaDB extends DBSchema {
  videoChunks: {
    key: number;
    value: {
      id: number;
      recordingId: string;
      chunk: ArrayBuffer;
      timestamp: number;
    };
    indexes: { 'by-recording': string };
  };
  finalVideo: {
    key: string;
    value: {
      recordingId: string;
      data: ArrayBuffer;
      timestamp: number;
    };
  };
  audioChunks: {
    key: number;
    value: {
      id: number;
      recordingId: string;
      index: number;
      data: ArrayBuffer;
      timestamp: number;
    };
    indexes: { 'by-recording': string };
  };
  screenshots: {
    key: string;
    value: Screenshot & { recordingId: string };
    indexes: { 'by-recording': string };
  };
  actions: {
    key: string;
    value: ActionLog & { recordingId: string };
    indexes: { 'by-recording': string };
  };
  networkEvents: {
    key: string;
    value: NetworkEvent & { recordingId: string };
    indexes: { 'by-recording': string };
  };
  metadata: {
    key: string;
    value: RecordingMetadata;
  };
}

const DB_NAME = 'teach-socia-db';
const DB_VERSION = 3;

let dbInstance: IDBPDatabase<TeachSociaDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<TeachSociaDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<TeachSociaDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        // Video chunks store
        const videoStore = db.createObjectStore('videoChunks', {
          keyPath: 'id',
          autoIncrement: true,
        });
        videoStore.createIndex('by-recording', 'recordingId');

        // Screenshots store
        const screenshotStore = db.createObjectStore('screenshots', {
          keyPath: 'id',
        });
        screenshotStore.createIndex('by-recording', 'recordingId');

        // Actions store
        const actionsStore = db.createObjectStore('actions', {
          keyPath: 'id',
        });
        actionsStore.createIndex('by-recording', 'recordingId');

        // Metadata store
        db.createObjectStore('metadata', {
          keyPath: 'recordingId',
        });

        db.createObjectStore('finalVideo', {
          keyPath: 'recordingId',
        });
      }

      if (oldVersion < 2) {
        // Audio chunks store (for transcription)
        const audioStore = db.createObjectStore('audioChunks', {
          keyPath: 'id',
          autoIncrement: true,
        });
        audioStore.createIndex('by-recording', 'recordingId');
      }

      if (oldVersion < 3) {
        // Network events store (for API call capture)
        const networkStore = db.createObjectStore('networkEvents', {
          keyPath: 'id',
        });
        networkStore.createIndex('by-recording', 'recordingId');
      }
    },
  });

  return dbInstance;
}

// Video chunks operations
export async function saveVideoChunk(
  recordingId: string,
  chunk: ArrayBuffer
): Promise<void> {
  const db = await getDB();
  await db.add('videoChunks', {
    id: Date.now(),
    recordingId,
    chunk,
    timestamp: Date.now(),
  });
}

export async function getVideoChunks(recordingId: string): Promise<ArrayBuffer[]> {
  const db = await getDB();
  const chunks = await db.getAllFromIndex('videoChunks', 'by-recording', recordingId);
  return chunks.sort((a, b) => a.timestamp - b.timestamp).map((c) => c.chunk);
}

export async function saveFinalVideo(recordingId: string, data: ArrayBuffer): Promise<void> {
  const db = await getDB();
  await db.put('finalVideo', {
    recordingId,
    data,
    timestamp: Date.now(),
  });
}

export async function getFinalVideo(recordingId: string): Promise<ArrayBuffer | null> {
  const db = await getDB();
  const entry = await db.get('finalVideo', recordingId);
  return entry?.data ?? null;
}

// Audio chunk operations (for transcription)
export async function saveAudioChunk(
  recordingId: string,
  index: number,
  data: ArrayBuffer
): Promise<void> {
  const db = await getDB();
  await db.add('audioChunks', {
    id: Date.now() + index,
    recordingId,
    index,
    data,
    timestamp: Date.now(),
  });
}

export async function getAudioChunks(recordingId: string): Promise<ArrayBuffer[]> {
  const db = await getDB();
  const chunks = await db.getAllFromIndex('audioChunks', 'by-recording', recordingId);
  return chunks.sort((a, b) => a.index - b.index).map((c) => c.data);
}

// Screenshot operations
export async function saveScreenshot(
  recordingId: string,
  screenshot: Screenshot
): Promise<void> {
  const db = await getDB();
  await db.put('screenshots', { ...screenshot, recordingId });
}

export async function getScreenshots(recordingId: string): Promise<Screenshot[]> {
  const db = await getDB();
  const screenshots = await db.getAllFromIndex('screenshots', 'by-recording', recordingId);
  return screenshots.sort((a, b) => a.timestamp - b.timestamp);
}

export async function getScreenshotCount(recordingId: string): Promise<number> {
  const db = await getDB();
  const screenshots = await db.getAllFromIndex('screenshots', 'by-recording', recordingId);
  return screenshots.length;
}

// Action operations
export async function saveAction(
  recordingId: string,
  action: ActionLog
): Promise<void> {
  const db = await getDB();
  await db.put('actions', { ...action, recordingId });
}

export async function getActions(recordingId: string): Promise<ActionLog[]> {
  const db = await getDB();
  const actions = await db.getAllFromIndex('actions', 'by-recording', recordingId);
  return actions.sort((a, b) => a.timestamp - b.timestamp);
}

export async function getActionCount(recordingId: string): Promise<number> {
  const db = await getDB();
  const actions = await db.getAllFromIndex('actions', 'by-recording', recordingId);
  return actions.length;
}

// Network event operations
export async function saveNetworkEvent(
  recordingId: string,
  event: NetworkEvent
): Promise<void> {
  const db = await getDB();
  await db.put('networkEvents', { ...event, recordingId });
}

export async function getNetworkEvents(recordingId: string): Promise<NetworkEvent[]> {
  const db = await getDB();
  const events = await db.getAllFromIndex('networkEvents', 'by-recording', recordingId);
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

export async function getNetworkEventCount(recordingId: string): Promise<number> {
  const db = await getDB();
  const events = await db.getAllFromIndex('networkEvents', 'by-recording', recordingId);
  return events.length;
}

// Metadata operations
export async function saveMetadata(metadata: RecordingMetadata): Promise<void> {
  const db = await getDB();
  await db.put('metadata', metadata);
}

export async function getMetadata(recordingId: string): Promise<RecordingMetadata | undefined> {
  const db = await getDB();
  return db.get('metadata', recordingId);
}

// Cleanup operations
export async function clearRecording(recordingId: string): Promise<void> {
  const db = await getDB();

  // Clear video chunks
  const videoChunks = await db.getAllFromIndex('videoChunks', 'by-recording', recordingId);
  for (const chunk of videoChunks) {
    await db.delete('videoChunks', chunk.id);
  }

  // Clear screenshots
  const screenshots = await db.getAllFromIndex('screenshots', 'by-recording', recordingId);
  for (const screenshot of screenshots) {
    await db.delete('screenshots', screenshot.id);
  }

  // Clear actions
  const actions = await db.getAllFromIndex('actions', 'by-recording', recordingId);
  for (const action of actions) {
    await db.delete('actions', action.id);
  }

  // Clear metadata
  await db.delete('metadata', recordingId);

  // Clear audio chunks
  const audioChunks = await db.getAllFromIndex('audioChunks', 'by-recording', recordingId);
  for (const chunk of audioChunks) {
    await db.delete('audioChunks', chunk.id);
  }

  // Clear network events
  const networkEvents = await db.getAllFromIndex('networkEvents', 'by-recording', recordingId);
  for (const event of networkEvents) {
    await db.delete('networkEvents', event.id);
  }

  // Clear final video
  await db.delete('finalVideo', recordingId);
}

export async function clearAllRecordings(): Promise<void> {
  const db = await getDB();
  await db.clear('videoChunks');
  await db.clear('audioChunks');
  await db.clear('screenshots');
  await db.clear('actions');
  await db.clear('networkEvents');
  await db.clear('metadata');
}

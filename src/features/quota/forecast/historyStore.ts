/**
 * Quota samples kept in this browser's IndexedDB, plus the ones recorded this
 * session, which a view sees as soon as they are taken.
 *
 * Without IndexedDB (private windows, tests) history lasts for the session.
 */

import { DAY_MS } from '@/utils/time/durations';
import { shouldRecordSample, type QuotaSample } from './history';

const DB_NAME = 'cpa-quota-history';
const DB_VERSION = 1;
const STORE = 'samples';
const BY_SCOPE_AT = 'scope_at';
const BY_AT = 'at';

/** Two weeks back from the default span's start, with room to page back once. */
export const HISTORY_RETENTION_MS = 21 * DAY_MS;

const sampleKey = (sample: QuotaSample) => `${sample.scope}\0${sample.credential}`;
const sampleIdentity = (sample: QuotaSample) => `${sampleKey(sample)}\0${sample.at}`;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function pruneExpired(db: IDBDatabase) {
  try {
    const range = IDBKeyRange.upperBound(Date.now() - HISTORY_RETENTION_MS);
    const request = db
      .transaction(STORE, 'readwrite')
      .objectStore(STORE)
      .index(BY_AT)
      .openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  } catch {
    // Pruning is housekeeping; a failure leaves old samples until the next visit.
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { autoIncrement: true });
      store.createIndex(BY_SCOPE_AT, ['scope', 'at']);
      store.createIndex(BY_AT, 'at');
    };
    request.onsuccess = () => {
      const db = request.result;
      pruneExpired(db);
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/* ---------- session samples ---------- */

const listeners = new Set<() => void>();
const lastWritten = new Map<string, QuotaSample>();
/** Replaced, never mutated, so it can serve as an external store snapshot. */
let sessionSamples: readonly QuotaSample[] = [];

export const subscribeQuotaHistory = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getSessionQuotaSamples = () => sessionSamples;

/** Keep the samples that add to their credential's history, and store them. */
export function recordQuotaSamples(samples: readonly QuotaSample[]) {
  const fresh = samples.filter((sample) => {
    const key = sampleKey(sample);
    if (!shouldRecordSample(lastWritten.get(key), sample)) return false;
    lastWritten.set(key, sample);
    return true;
  });
  if (fresh.length === 0) return;

  const oldest = Date.now() - HISTORY_RETENTION_MS;
  sessionSamples = [...sessionSamples.filter((sample) => sample.at >= oldest), ...fresh];
  listeners.forEach((listener) => listener());

  void openDatabase().then((db) => {
    if (!db) return;
    try {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      fresh.forEach((sample) => store.add(sample));
    } catch {
      // The session copy still serves this visit.
    }
  });
}

export async function readQuotaSamples(scope: string, fromMs: number): Promise<QuotaSample[]> {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const range = IDBKeyRange.bound([scope, fromMs], [scope, Number.POSITIVE_INFINITY]);
      const request = db
        .transaction(STORE, 'readonly')
        .objectStore(STORE)
        .index(BY_SCOPE_AT)
        .getAll(range);
      request.onsuccess = () => resolve(request.result as QuotaSample[]);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Stored and session samples together, each once. */
export function mergeQuotaSamples(
  stored: readonly QuotaSample[],
  session: readonly QuotaSample[]
): QuotaSample[] {
  const seen = new Set(stored.map(sampleIdentity));
  return [...stored, ...session.filter((sample) => !seen.has(sampleIdentity(sample)))];
}

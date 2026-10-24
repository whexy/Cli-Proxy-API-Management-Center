import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent, useQuotaStore } from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { QUOTA_PAGE_SIZE } from '../constants';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, getQuotaMap, getQuotaSetter, type QuotaCardState } from '../providers';
import { enrichQuotaInBackground } from '../quotaEnrichment';
import { QUOTA_AUTO_REFRESH_MS } from './constants';
import { chunk } from './ledgerModel';

const DUE_CHECK_MS = 5_000;

export const isQuotaRefreshDue = (
  lastStartedAtMs: number,
  nowMs: number,
  visibility: DocumentVisibilityState
) => visibility === 'visible' && nowMs - lastStartedAtMs >= QUOTA_AUTO_REFRESH_MS;

/**
 * Keeps every credential's quota current while the quota page is open: once
 * when a session's credential list settles, then whenever the last refresh
 * started a minute ago and the tab is visible. A hidden tab catches up as soon
 * as it is shown.
 *
 * Results replace each credential's state in place. The batch loader first
 * swaps every state for a loading one, which would blank all but Claude's rows
 * each minute, so only credentials without a result yet show loading.
 * Upstream calls stay capped at QUOTA_PAGE_SIZE at a time, as pagination caps
 * the cards view.
 */
export function useQuotaAutoRefresh(entries: QuotaFileEntry[], ready: boolean) {
  const { t } = useTranslation();
  const session = useQuotaStore((state) => state.cacheGeneration);
  const [refreshing, setRefreshing] = useState(false);
  const runningRef = useRef(false);
  const startedAtRef = useRef(0);
  const mountedRef = useRef(false);
  const entriesRef = useRef(entries);
  const refreshedSessionRef = useRef<number | null>(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshEntry = useCallback(
    async (entry: QuotaFileEntry) => {
      const adapter = QUOTA_ADAPTERS[entry.type];
      const cacheKey = getQuotaCacheKey(entry.file);
      const generation = captureQuotaCacheGeneration(entry.file.name);
      let data: unknown;
      let next: QuotaCardState;
      try {
        data = await adapter.fetchQuota(entry.file, t);
        next = adapter.buildSuccessState(data);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        next = adapter.buildErrorState(message, getStatusFromError(err));
      }
      const committed = commitIfQuotaCacheCurrent(generation, () => {
        getQuotaSetter(adapter)((prev) => ({ ...prev, [cacheKey]: next }));
      });
      if (committed && next.status === 'success') {
        void enrichQuotaInBackground(adapter, entry.file, data, next, t);
      }
    },
    [t]
  );

  const refreshAll = useCallback(
    async (targets: QuotaFileEntry[]) => {
      if (runningRef.current || targets.length === 0) return;
      runningRef.current = true;
      startedAtRef.current = Date.now();
      setRefreshing(true);
      const startSession = useQuotaStore.getState().cacheGeneration;
      try {
        for (const batch of chunk(targets, QUOTA_PAGE_SIZE)) {
          if (!mountedRef.current || useQuotaStore.getState().cacheGeneration !== startSession) {
            return;
          }
          batch.forEach(({ type, file }) => {
            const adapter = QUOTA_ADAPTERS[type];
            const cacheKey = getQuotaCacheKey(file);
            if (getQuotaMap(adapter)[cacheKey]) return;
            getQuotaSetter(adapter)((prev) => ({
              ...prev,
              [cacheKey]: adapter.buildLoadingState(),
            }));
          });
          await Promise.all(batch.map(refreshEntry));
        }
      } finally {
        runningRef.current = false;
        setRefreshing(false);
      }
    },
    [refreshEntry]
  );

  useEffect(() => {
    if (!ready || refreshedSessionRef.current === session) return;
    refreshedSessionRef.current = session;
    // Due at once, so a run of the previous session still in flight is followed up.
    startedAtRef.current = 0;
    void refreshAll(entries);
  }, [entries, ready, refreshAll, session]);

  useEffect(() => {
    if (!ready) return;
    const refreshIfDue = () => {
      if (isQuotaRefreshDue(startedAtRef.current, Date.now(), document.visibilityState)) {
        void refreshAll(entriesRef.current);
      }
    };
    const timer = window.setInterval(refreshIfDue, DUE_CHECK_MS);
    document.addEventListener('visibilitychange', refreshIfDue);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfDue);
    };
  }, [ready, refreshAll]);

  return { refreshing, refreshAll };
}
